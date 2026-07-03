import { Type } from "typebox";
import {
  defineTool,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { importCommandOperations } from "../tui/command-imports.js";
import { maintenanceCommandOperations } from "../tui/command-maintenance.js";
import { sessionCommandOperations } from "../tui/command-session.js";
import type { MemoryOperationsDeps } from "./memory-operation-service.js";
import { createMemoryOperations } from "./memory-operation-service.js";
import { formatReflectResult } from "./reflect-presenter.js";
import { runHindsightSetupTui } from "../tui/setup-tui.js";
import { renderMemoryToolTextResult, retainToolResponse } from "../tui/tool-presenters.js";

export type ToolOperation = Parameters<ExtensionAPI["registerTool"]>[0];

const tagMatchSchema = Type.Union(
  [
    Type.Literal("any"),
    Type.Literal("all"),
    Type.Literal("any_strict"),
    Type.Literal("all_strict"),
    Type.Literal("exact"),
  ],
  {
    description:
      "How to match tags. Always enforced together with the automatic Pi project/user scope tag filter. 'exact' folds the automatic scope tags into the exact-match set (memory tags must equal scope tags plus these tags, no more, no less) instead of AND-ing a separate scope group, since scope tags must still be present. Note: 'exact' with empty/omitted tags -- Hindsight's pattern for recalling shared/untagged observations -- is incompatible with scope isolation and will not surface those observations here; see issue #450.",
  },
);

const budgetSchema = Type.Union([Type.Literal("low"), Type.Literal("mid"), Type.Literal("high")]);

const recallTypeSchema = Type.Union([
  Type.Literal("world"),
  Type.Literal("experience"),
  Type.Literal("observation"),
]);

const tagGroupJsonSchema = {
  type: "object",
  required: ["tags"],
  properties: {
    tags: { type: "array", items: { type: "string" } },
    match: { enum: ["any", "all", "any_strict", "all_strict"] },
  },
  additionalProperties: false,
};

const tagGroupSchema = Type.Unsafe<import("../types.js").HindsightTagGroup>(tagGroupJsonSchema);

function tagGroupsSchema(description: string) {
  return Type.Optional(Type.Array(tagGroupSchema, { description }));
}

const retainEntitySchema = Type.Object({
  text: Type.String({ description: "Entity text to associate with the retained content." }),
  type: Type.Optional(Type.String({ description: "Optional entity type." })),
});

const retainUpdateModeSchema = Type.Union([Type.Literal("append"), Type.Literal("replace")], {
  description: "Optional Hindsight update mode for this explicit retain call.",
});

const observationScopesSchema = Type.Unsafe<import("../types.js").HindsightObservationScopes>({
  ...Type.Union([
    Type.Literal("per_tag"),
    Type.Literal("combined"),
    Type.Literal("all_combinations"),
    Type.Literal("shared"),
    Type.Array(Type.Array(Type.String())),
  ]),
  description:
    "Optional Hindsight observation scopes. Use per_tag, combined, all_combinations, shared, or explicit string groups. When provided, overrides configured default observation scopes for this retain call.",
});

function explicitRetainOptionParameters() {
  return {
    documentId: Type.Optional(
      Type.String({
        description:
          "Optional Hindsight document ID. Defaults to the existing deterministic explicit retain document ID.",
      }),
    ),
    timestamp: Type.Optional(
      Type.String({
        description:
          "Optional Hindsight timestamp string, including ISO-ish strings or literal unset, passed through as provided.",
      }),
    ),
    metadata: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Optional caller metadata string map. Reserved provenance keys such as cwd, pi_session_file, source, and retainSource are set by pi-hindsight and cannot be overridden.",
      }),
    ),
    updateMode: Type.Optional(retainUpdateModeSchema),
    observationScopes: Type.Optional(observationScopesSchema),
    documentTags: Type.Optional(
      Type.Array(Type.String(), {
        description: "Optional Hindsight document_tags for this retained document when supported.",
      }),
    ),
    async: Type.Optional(
      Type.Boolean({
        description:
          "Optional Hindsight async extraction flag for this retain call. Defaults to configured retain.async.",
      }),
    ),
  };
}

type ExplicitRetainOptionParams = {
  documentId?: string;
  timestamp?: string;
  metadata?: Record<string, string>;
  updateMode?: import("../types.js").UpdateMode;
  observationScopes?: import("../types.js").HindsightObservationScopes;
  documentTags?: string[];
  async?: boolean;
};

function explicitRetainOptions(params: ExplicitRetainOptionParams) {
  return {
    ...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
    ...(params.timestamp !== undefined ? { timestamp: params.timestamp } : {}),
    ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    ...(params.updateMode !== undefined ? { updateMode: params.updateMode } : {}),
    ...(params.observationScopes !== undefined
      ? { observationScopes: params.observationScopes }
      : {}),
    ...(params.documentTags !== undefined ? { documentTags: params.documentTags } : {}),
    ...(params.async !== undefined ? { async: params.async } : {}),
  };
}

function defineCatalogTool<TParams extends ToolDefinition["parameters"], TDetails = unknown>(
  tool: ToolDefinition<TParams, TDetails>,
): ToolOperation {
  return defineTool(tool);
}
export type CommandOperation = {
  name: string;
  spec: Parameters<ExtensionAPI["registerCommand"]>[1];
};

export interface OperationCatalog {
  tools: ToolOperation[];
  commands: CommandOperation[];
}

export function createOperationCatalog(deps: MemoryOperationsDeps): OperationCatalog {
  const operations = createMemoryOperations(deps);
  const useCwd = (cwd: string) => deps.reloadConfig?.(cwd);

  const tools: ToolOperation[] = [
    defineCatalogTool({
      name: "hindsight_recall",
      label: "Hindsight Recall",
      description: "Recall raw memories from Hindsight for this project.",
      parameters: Type.Object({
        query: Type.String({ description: "Natural language memory query" }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        types: Type.Optional(
          Type.Array(recallTypeSchema, {
            description: "Optional Hindsight fact types to retrieve.",
          }),
        ),
        preferObservations: Type.Optional(
          Type.Boolean({
            description:
              "When recalling raw facts ('world'/'experience') together with 'observation', drop raw facts superseded by a returned observation. Defaults to the configured recall.preferObservations.",
          }),
        ),
        minScores: Type.Optional(
          Type.Unsafe<import("@vectorize-io/hindsight-client").MinScores>({
            ...Type.Object({
              semantic: Type.Optional(
                Type.Number({ description: "Minimum vector similarity (0-1)." }),
              ),
              keyword: Type.Optional(Type.Number({ description: "Minimum keyword/BM25 score." })),
              reranker: Type.Optional(
                Type.Number({ description: "Minimum normalized reranker score (0-1)." }),
              ),
              final: Type.Optional(Type.Number({ description: "Minimum final ranking score." })),
            }),
            description:
              "Optional per-stage score floors. Omitted stages impose no floor. No floor by default.",
          }),
        ),
        budget: Type.Optional(
          Type.Unsafe<import("../types.js").Budget>({
            ...budgetSchema,
            description: "Optional Hindsight recall budget override for this tool call.",
          }),
        ),
        maxTokens: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              "Optional Hindsight recall token cap override for this tool call. Use 0 for metadata/source-only recall when supported by Hindsight.",
          }),
        ),
        queryTimestamp: Type.Optional(
          Type.String({ description: "Optional ISO timestamp for time-scoped recall." }),
        ),
        includeChunks: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight to include source chunks when supported." }),
        ),
        recallChunksMaxTokens: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: "Optional token cap for included recall chunks.",
          }),
        ),
        includeSourceFacts: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight to include source facts when supported." }),
        ),
        maxSourceFactsTokens: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: "Optional token cap for included source facts.",
          }),
        ),
        includeEntities: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight to include entities when supported." }),
        ),
        trace: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight to include recall trace/debug data." }),
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Additional tag filter." })),
        tagsMatch: Type.Optional(tagMatchSchema),
        tagGroups: tagGroupsSchema(
          "Compound Hindsight tag_groups filter. AND-ed with the automatic Pi project/user scope filter.",
        ),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = ctx.sessionManager.getSessionFile?.();
        const { bankId, result } = await operations.recall(
          ctx.cwd,
          params.query,
          params.bank,
          sessionFile,
          {
            ...(params.types ? { types: params.types } : {}),
            ...(params.preferObservations !== undefined
              ? { preferObservations: params.preferObservations }
              : {}),
            ...(params.minScores !== undefined ? { minScores: params.minScores } : {}),
            ...(params.budget ? { budget: params.budget } : {}),
            ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
            ...(params.queryTimestamp ? { queryTimestamp: params.queryTimestamp } : {}),
            ...(params.includeChunks !== undefined ? { includeChunks: params.includeChunks } : {}),
            ...(params.recallChunksMaxTokens !== undefined
              ? { maxChunkTokens: params.recallChunksMaxTokens }
              : {}),
            ...(params.includeSourceFacts !== undefined
              ? { includeSourceFacts: params.includeSourceFacts }
              : {}),
            ...(params.maxSourceFactsTokens !== undefined
              ? { maxSourceFactsTokens: params.maxSourceFactsTokens }
              : {}),
            ...(params.includeEntities !== undefined
              ? { includeEntities: params.includeEntities }
              : {}),
            ...(params.trace !== undefined ? { trace: params.trace } : {}),
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.tagGroups
              ? { tagGroups: params.tagGroups as import("../types.js").HindsightTagGroup[] }
              : {}),
            ...(signal ? { signal } : {}),
          },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { bankId },
        };
      },
      renderResult: renderMemoryToolTextResult,
    }),
    defineCatalogTool({
      name: "hindsight_retain",
      label: "Hindsight Retain",
      description: "Retain explicit raw content in Hindsight. Use for durable facts or decisions.",
      parameters: Type.Object({
        content: Type.String({
          description: "Raw content to retain, not summary if source content is available.",
        }),
        context: Type.String({ description: "Source context for this memory." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        tags: Type.Optional(Type.Array(Type.String())),
        entities: Type.Optional(
          Type.Array(retainEntitySchema, {
            description: "Optional Hindsight entities to associate with this retained content.",
          }),
        ),
        ...explicitRetainOptionParameters(),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = ctx.sessionManager.getSessionFile?.();
        const result = await operations.retainExplicit({
          cwd: ctx.cwd,
          content: params.content,
          context: params.context,
          ...(sessionFile ? { sessionFile } : {}),
          ...(params.bank ? { bank: params.bank } : {}),
          ...(params.tags ? { tags: params.tags } : {}),
          ...(params.entities ? { entities: params.entities } : {}),
          ...explicitRetainOptions(params),
        });
        return retainToolResponse(result);
      },
      renderResult: renderMemoryToolTextResult,
    }),
    defineCatalogTool({
      name: "hindsight_retain_global",
      label: "Hindsight Retain User",
      description:
        "Retain explicit durable user memory in the configured user bank. Use for stable user identity, preferences, and cross-project workflows only.",
      parameters: Type.Object({
        content: Type.String({ description: "Raw memory content to retain." }),
        context: Type.String({ description: "Why this memory is durable user context." }),
        tags: Type.Optional(Type.Array(Type.String())),
        entities: Type.Optional(
          Type.Array(retainEntitySchema, {
            description: "Optional Hindsight entities to associate with this retained content.",
          }),
        ),
        ...explicitRetainOptionParameters(),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = ctx.sessionManager.getSessionFile?.();
        const result = await operations.retainExplicit({
          cwd: ctx.cwd,
          content: params.content,
          context: params.context,
          bank: "global",
          ...(sessionFile ? { sessionFile } : {}),
          ...(params.tags ? { tags: params.tags } : {}),
          ...(params.entities ? { entities: params.entities } : {}),
          ...explicitRetainOptions(params),
        });
        return retainToolResponse(result);
      },
      renderResult: renderMemoryToolTextResult,
    }),
    defineCatalogTool({
      name: "hindsight_reflect",
      label: "Hindsight Reflect",
      description:
        "Ask Hindsight to synthesize an answer from memory. Use explicitly, not for default recall.",
      parameters: Type.Object({
        query: Type.String(),
        context: Type.Optional(Type.String()),
        bank: Type.Optional(Type.String()),
        budget: Type.Optional(
          Type.Unsafe<import("../types.js").Budget>({
            ...budgetSchema,
            description: "Optional Hindsight reflect budget override for this tool call.",
          }),
        ),
        maxTokens: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: "Optional Hindsight reflect token cap override for this tool call.",
          }),
        ),
        responseSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        includeFacts: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight reflect to include facts when supported." }),
        ),
        includeToolCalls: Type.Optional(
          Type.Boolean({
            description: "Ask Hindsight reflect to include tool-call trace data when supported.",
          }),
        ),
        includeToolCallOutput: Type.Optional(
          Type.Boolean({
            description:
              "When includeToolCalls is set, include tool-call outputs (default true); set false for an inputs-only trace.",
          }),
        ),
        factTypes: Type.Optional(
          Type.Array(recallTypeSchema, {
            description: "Restrict reflection to these Hindsight fact types.",
          }),
        ),
        excludeMentalModels: Type.Optional(
          Type.Boolean({ description: "Exclude all mental models from reflection." }),
        ),
        excludeMentalModelIds: Type.Optional(
          Type.Array(Type.String(), {
            description: "Exclude specific mental models by id from reflection.",
          }),
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Additional tag filter." })),
        tagsMatch: Type.Optional(tagMatchSchema),
        tagGroups: tagGroupsSchema(
          "Compound Hindsight tag_groups filter. AND-ed with the automatic Pi project/user scope filter.",
        ),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const { bankId, result } = await operations.reflect(
          ctx.cwd,
          params.query,
          params.context,
          params.bank,
          params.responseSchema,
          {
            ...(params.budget ? { budget: params.budget } : {}),
            ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
            ...(params.includeFacts !== undefined ? { includeFacts: params.includeFacts } : {}),
            ...(params.includeToolCalls !== undefined
              ? { includeToolCalls: params.includeToolCalls }
              : {}),
            ...(params.includeToolCallOutput !== undefined
              ? { includeToolCallOutput: params.includeToolCallOutput }
              : {}),
            ...(params.factTypes ? { factTypes: params.factTypes } : {}),
            ...(params.excludeMentalModels !== undefined
              ? { excludeMentalModels: params.excludeMentalModels }
              : {}),
            ...(params.excludeMentalModelIds
              ? { excludeMentalModelIds: params.excludeMentalModelIds }
              : {}),
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.tagGroups
              ? { tagGroups: params.tagGroups as import("../types.js").HindsightTagGroup[] }
              : {}),
            ...(signal ? { signal } : {}),
          },
        );
        return {
          content: [{ type: "text", text: formatReflectResult(result) }],
          details: { bankId },
        };
      },
      renderResult: renderMemoryToolTextResult,
    }),
  ];

  const commands: CommandOperation[] = [
    {
      name: "hindsight",
      spec: {
        description: "Open Hindsight memory TUI.",
        handler: async (_args, ctx) => {
          await runHindsightSetupTui(ctx, deps);
        },
      },
    },
    {
      name: "hindsight:init",
      spec: {
        description: "Write .pi/hindsight.json with the currently selected project bank.",
        handler: async (_args, ctx) => {
          const result = await operations.init(ctx.cwd);
          ctx.ui.notify(
            `Wrote ${result.path}; project bank ${result.projectBankId}. Run /hindsight to inspect status.`,
            "info",
          );
        },
      },
    },
    ...importCommandOperations(operations),
    ...sessionCommandOperations(operations),
    ...maintenanceCommandOperations(operations),
  ];

  return { tools, commands };
}
