import { Type } from "typebox";
import {
  defineTool,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { importCommandOperations } from "./command-imports.js";
import { maintenanceCommandOperations } from "./command-maintenance.js";
import { sessionCommandOperations } from "./command-session.js";
import type { MemoryOperationsDeps } from "./memory-operation-service.js";
import { createMemoryOperations } from "./memory-operation-service.js";
import { getSessionFile } from "./session.js";
import { runHindsightSetupTui } from "./setup-tui.js";
import {
  configureToolResponse,
  bankProfileToolResponse,
  createDirectiveToolResponse,
  deleteDirectiveToolResponse,
  deleteDocumentToolResponse,
  documentToolResponse,
  entityToolResponse,
  exportBankTemplateToolResponse,
  chatTranscriptImportToolResponse,
  getBankConfigToolResponse,
  getBankTemplateSchemaToolResponse,
  getDirectiveToolResponse,
  graphToolResponse,
  importToolResponse,
  jsonToolResponse,
  listDirectivesToolResponse,
  listDocumentsToolResponse,
  listEntitiesToolResponse,
  listMemoriesToolResponse,
  listOperationsToolResponse,
  listTagsToolResponse,
  operationToolResponse,
  resetBankConfigToolResponse,
  retainReceiptListToolResponse,
  retainToolResponse,
  routeMemoryToolResponse,
  updateDirectiveToolResponse,
} from "./tool-presenters.js";

export type ToolOperation = Parameters<ExtensionAPI["registerTool"]>[0];

const tagMatchSchema = Type.Union([
  Type.Literal("any"),
  Type.Literal("all"),
  Type.Literal("any_strict"),
  Type.Literal("all_strict"),
]);

const budgetSchema = Type.Union([Type.Literal("low"), Type.Literal("mid"), Type.Literal("high")]);

const recallTypeSchema = Type.Union([
  Type.Literal("world"),
  Type.Literal("experience"),
  Type.Literal("observation"),
]);

const tagGroupJsonSchema = {
  $id: "HindsightTagGroup",
  anyOf: [
    {
      type: "object",
      required: ["tags"],
      properties: {
        tags: { type: "array", items: { type: "string" } },
        match: { enum: ["any", "all", "any_strict", "all_strict"] },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["and"],
      properties: { and: { type: "array", items: { $ref: "HindsightTagGroup" } } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["or"],
      properties: { or: { type: "array", items: { $ref: "HindsightTagGroup" } } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["not"],
      properties: { not: { $ref: "HindsightTagGroup" } },
      additionalProperties: false,
    },
  ],
};

const tagGroupSchema = Type.Unsafe<import("./types.js").HindsightTagGroup>(tagGroupJsonSchema);

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

const observationScopesSchema = Type.Unsafe<import("./types.js").HindsightObservationScopes>({
  ...Type.Union([
    Type.Literal("per_tag"),
    Type.Literal("combined"),
    Type.Literal("all_combinations"),
    Type.Array(Type.Array(Type.String())),
  ]),
  description:
    "Optional Hindsight observation scopes. Use per_tag, combined, all_combinations, or explicit string groups. When provided, overrides configured default observation scopes for this retain call.",
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
  updateMode?: import("./types.js").UpdateMode;
  observationScopes?: import("./types.js").HindsightObservationScopes;
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
        budget: Type.Optional(
          Type.Unsafe<import("./types.js").Budget>({
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
              ? { tagGroups: params.tagGroups as import("./types.js").HindsightTagGroup[] }
              : {}),
            ...(signal ? { signal } : {}),
          },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { bankId },
        };
      },
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
    }),
    defineCatalogTool({
      name: "hindsight_retain_receipts",
      label: "Hindsight Retain Receipts",
      description: "List recent explicit retain receipts so exact document IDs can be deleted.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: "Maximum receipts to return. Defaults to 10." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listRetainReceipts(ctx.cwd, params.limit);
        return retainReceiptListToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_route_memory",
      label: "Hindsight Route Memory",
      description:
        "Dry-run memory routing against current project/user policy. Does not retain anything.",
      parameters: Type.Object({
        content: Type.String({ description: "Candidate memory content to classify." }),
        context: Type.Optional(Type.String({ description: "Optional context for routing." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = getSessionFile(ctx);
        const result = operations.routeMemory({
          content: params.content,
          ...(params.context ? { context: params.context } : {}),
          cwd: ctx.cwd,
          ...(sessionFile ? { sessionFile } : {}),
        });
        return routeMemoryToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_delete_document",
      label: "Hindsight Delete Document",
      description:
        "Delete a specific Hindsight document and all memories extracted from it. Destructive; requires exact bank and document ID.",
      parameters: Type.Object({
        bank: Type.String({ description: "Bank ID containing the document." }),
        documentId: Type.String({ description: "Exact Hindsight document ID to delete." }),
        confirm: Type.Boolean({ description: "Must be true to confirm destructive deletion." }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        if (!params.confirm) throw new Error("Set confirm=true to delete this Hindsight document.");
        const result = await operations.deleteDocument({
          bank: params.bank,
          documentId: params.documentId,
        });
        return deleteDocumentToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_documents",
      label: "Hindsight List Documents",
      description: "List Hindsight documents for compact inspection with supported filters.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        q: Type.Optional(Type.String({ description: "Optional text query filter." })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tag filter." })),
        tagsMatch: Type.Optional(tagMatchSchema),
        limit: Type.Optional(Type.Number({ description: "Maximum documents to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listDocuments({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.q ? { q: params.q } : {}),
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listDocumentsToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_document",
      label: "Hindsight Get Document",
      description: "Fetch one Hindsight document by ID for inspection.",
      parameters: Type.Object({
        documentId: Type.String({ description: "Exact Hindsight document ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getDocument({
          documentId: params.documentId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return documentToolResponse(`Document ${params.documentId} in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_update_document_tags",
      label: "Hindsight Update Document Tags",
      description: "Replace document tags for one Hindsight document. Requires confirm=true.",
      parameters: Type.Object({
        documentId: Type.String({ description: "Exact Hindsight document ID." }),
        tags: Type.Array(Type.String(), { description: "Replacement tag set." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required mutation confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.updateDocumentTags({
          documentId: params.documentId,
          request: { tags: params.tags },
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return documentToolResponse(`Updated document ${params.documentId} tags.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_entities",
      label: "Hindsight List Entities",
      description: "List Hindsight entities for compact inspection.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        limit: Type.Optional(Type.Number({ description: "Maximum entities to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listEntities({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listEntitiesToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_entity",
      label: "Hindsight Get Entity",
      description: "Fetch one Hindsight entity by ID.",
      parameters: Type.Object({
        entityId: Type.String({ description: "Hindsight entity ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getEntity({
          entityId: params.entityId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return entityToolResponse(`Entity ${params.entityId} in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_regenerate_entity",
      label: "Hindsight Regenerate Entity",
      description:
        "Regenerate observations for one Hindsight entity. Expensive mutation; requires confirm=true.",
      parameters: Type.Object({
        entityId: Type.String({ description: "Hindsight entity ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required mutation confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.regenerateEntity({
          entityId: params.entityId,
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return entityToolResponse(`Regenerated entity ${params.entityId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_graph",
      label: "Hindsight Get Graph",
      description: "Explore Hindsight graph with supported filters.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        type: Type.Optional(
          Type.Union([Type.Literal("world"), Type.Literal("experience"), Type.Literal("opinion")], {
            description:
              "Optional graph fact type filter. Hindsight supports world, experience, or opinion.",
          }),
        ),
        q: Type.Optional(Type.String({ description: "Optional text query filter." })),
        limit: Type.Optional(Type.Number({ description: "Maximum graph items to return." })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tag filter." })),
        tagsMatch: Type.Optional(tagMatchSchema),
        documentId: Type.Optional(Type.String({ description: "Optional document ID filter." })),
        chunkId: Type.Optional(Type.String({ description: "Optional chunk ID filter." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getGraph({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.type ? { type: params.type } : {}),
            ...(params.q ? { q: params.q } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.documentId ? { documentId: params.documentId } : {}),
            ...(params.chunkId ? { chunkId: params.chunkId } : {}),
          },
        });
        return graphToolResponse(`Graph in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_entity_graph",
      label: "Hindsight Get Entity Graph",
      description: "Fetch Hindsight entity graph summary when server supports it.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        limit: Type.Optional(Type.Number({ description: "Maximum graph items to return." })),
        minCount: Type.Optional(Type.Number({ description: "Minimum entity count filter." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getEntityGraph({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.minCount !== undefined ? { minCount: params.minCount } : {}),
          },
        });
        return graphToolResponse(`Entity graph in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_tags",
      label: "Hindsight List Tags",
      description: "List Hindsight tags for compact inspection.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        q: Type.Optional(Type.String({ description: "Optional tag text filter." })),
        source: Type.Optional(
          Type.Union([Type.Literal("memories"), Type.Literal("mental_models")]),
        ),
        limit: Type.Optional(Type.Number({ description: "Maximum tags to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listTags({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.q ? { q: params.q } : {}),
            ...(params.source ? { source: params.source } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listTagsToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_operations",
      label: "Hindsight List Operations",
      description: "List Hindsight async operations for a bank with supported server filters.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        status: Type.Optional(Type.String({ description: "Optional operation status filter." })),
        taskType: Type.Optional(Type.String({ description: "Optional task type filter." })),
        limit: Type.Optional(Type.Number({ description: "Maximum operations to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listOperations({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.status
              ? { status: params.status as import("./types.js").OperationStatus }
              : {}),
            ...(params.taskType ? { taskType: params.taskType } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listOperationsToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_cancel_operation",
      label: "Hindsight Cancel Operation",
      description: "Cancel a pending Hindsight async operation. Requires confirm=true.",
      parameters: Type.Object({
        operationId: Type.String({ description: "Hindsight operation ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required destructive-action confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.cancelOperation({
          operationId: params.operationId,
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return operationToolResponse("Cancelled", result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_retry_operation",
      label: "Hindsight Retry Operation",
      description: "Retry a failed or cancelled Hindsight async operation.",
      parameters: Type.Object({
        operationId: Type.String({ description: "Hindsight operation ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.retryOperation({
          operationId: params.operationId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return operationToolResponse("Retried", result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_memories",
      label: "Hindsight List Memories",
      description: "List raw Hindsight memory units for inspection.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        type: Type.Optional(Type.String({ description: "Optional memory type filter." })),
        q: Type.Optional(Type.String({ description: "Optional text query filter." })),
        limit: Type.Optional(Type.Number({ description: "Maximum memories to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listMemories({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.type ? { type: params.type } : {}),
            ...(params.q ? { q: params.q } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listMemoriesToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_memory",
      label: "Hindsight Get Memory",
      description: "Fetch a raw Hindsight memory unit by ID.",
      parameters: Type.Object({
        memoryId: Type.String({ description: "Hindsight memory ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getMemory({
          memoryId: params.memoryId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return jsonToolResponse(`Memory ${params.memoryId} in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_chunk",
      label: "Hindsight Get Chunk",
      description: "Fetch a raw Hindsight source chunk by chunk ID.",
      parameters: Type.Object({
        chunkId: Type.String({ description: "Hindsight chunk ID." }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getChunk({ chunkId: params.chunkId });
        return jsonToolResponse(`Chunk ${params.chunkId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_memory_history",
      label: "Hindsight Get Memory History",
      description: "Fetch Hindsight memory history by memory ID when server supports it.",
      parameters: Type.Object({
        memoryId: Type.String({ description: "Hindsight memory ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getMemoryHistory({
          memoryId: params.memoryId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return jsonToolResponse(`Memory history ${params.memoryId} in ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_delete_memory_observations",
      label: "Hindsight Delete Memory Observations",
      description:
        "Delete observations for one Hindsight memory. Destructive; requires exact memory ID and confirm=true.",
      parameters: Type.Object({
        memoryId: Type.String({ description: "Hindsight memory ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required destructive-action confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.deleteMemoryObservations({
          memoryId: params.memoryId,
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return jsonToolResponse(`Deleted observations for memory ${params.memoryId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_configure",
      label: "Hindsight Configure",
      description:
        "Write project Hindsight config (.pi/hindsight.json), including project bank override.",
      parameters: Type.Object({
        projectBankId: Type.Optional(
          Type.String({
            description: "Project bank ID to use. Defaults to currently selected bank.",
          }),
        ),
        baseUrl: Type.Optional(
          Type.String({ description: "Hindsight base URL, e.g. http://localhost:8888" }),
        ),
        globalBankId: Type.Optional(Type.String({ description: "Optional user bank ID." })),
        enableGlobalBank: Type.Optional(
          Type.Boolean({ description: "Enable or disable user bank." }),
        ),
        enabled: Type.Optional(
          Type.Boolean({ description: "Enable or disable Hindsight extension." }),
        ),
        queuePath: Type.Optional(
          Type.String({
            description: "Retain queue path. Defaults to .pi/hindsight/retain-queue.jsonl.",
          }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.configure(ctx.cwd, params);
        return configureToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_bank_config",
      label: "Hindsight Get Bank Config",
      description: "Read resolved Hindsight bank config and override counts for a selected bank.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getBankConfig(params.bank ? { bank: params.bank } : {});
        return getBankConfigToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_bank_profile",
      label: "Hindsight Get Bank Profile",
      description: "Read Hindsight bank profile/background/disposition.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getBankProfile(params.bank ? { bank: params.bank } : {});
        return bankProfileToolResponse(`Bank profile ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_update_bank_profile",
      label: "Hindsight Update Bank Profile",
      description: "Patch supported Hindsight bank profile fields. Requires confirm=true.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        mission: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        background: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        reflectMission: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        retainMission: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        observationsMission: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        confirm: Type.Literal(true, {
          description: "Required admin mutation confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.updateBankProfile({
          ...(params.bank ? { bank: params.bank } : {}),
          request: {
            ...(params.name !== undefined ? { name: params.name } : {}),
            ...(params.mission !== undefined ? { mission: params.mission } : {}),
            ...(params.background !== undefined ? { background: params.background } : {}),
            ...(params.reflectMission !== undefined
              ? { reflectMission: params.reflectMission }
              : {}),
            ...(params.retainMission !== undefined ? { retainMission: params.retainMission } : {}),
            ...(params.observationsMission !== undefined
              ? { observationsMission: params.observationsMission }
              : {}),
          },
          confirm: params.confirm,
        });
        return bankProfileToolResponse(`Updated bank profile ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_update_bank_disposition",
      label: "Hindsight Update Bank Disposition",
      description: "Update bank disposition traits. Requires confirm=true.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        skepticism: Type.Integer({ minimum: 1, maximum: 5 }),
        literalism: Type.Integer({ minimum: 1, maximum: 5 }),
        empathy: Type.Integer({ minimum: 1, maximum: 5 }),
        confirm: Type.Literal(true, {
          description: "Required admin mutation confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.updateBankDisposition({
          ...(params.bank ? { bank: params.bank } : {}),
          disposition: {
            skepticism: params.skepticism,
            literalism: params.literalism,
            empathy: params.empathy,
          },
          confirm: params.confirm,
        });
        return bankProfileToolResponse(`Updated bank disposition ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_add_bank_background",
      label: "Hindsight Add Bank Background",
      description: "Append bank background. Optional disposition update; requires confirm=true.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        content: Type.String({ description: "Background text to append." }),
        updateDisposition: Type.Optional(
          Type.Boolean({ description: "Ask Hindsight to update disposition from background." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required admin mutation confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.addBankBackground({
          ...(params.bank ? { bank: params.bank } : {}),
          request: {
            content: params.content,
            ...(params.updateDisposition !== undefined
              ? { updateDisposition: params.updateDisposition }
              : {}),
          },
          confirm: params.confirm,
        });
        return bankProfileToolResponse(`Added bank background ${result.bankId}.`, result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_reset_bank_config",
      label: "Hindsight Reset Bank Config",
      description: "Reset Hindsight bank config overrides for a selected bank.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required destructive-action confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.resetBankConfig({
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return resetBankConfigToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_list_directives",
      label: "Hindsight List Directives",
      description: "List bank-owned Hindsight directives (hard reflect rules).",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tag filter." })),
        tagsMatch: Type.Optional(
          Type.Union([Type.Literal("any"), Type.Literal("all"), Type.Literal("exact")]),
        ),
        activeOnly: Type.Optional(Type.Boolean({ description: "Only return active directives." })),
        limit: Type.Optional(Type.Number({ description: "Maximum directives to return." })),
        offset: Type.Optional(Type.Number({ description: "Pagination offset." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.listDirectives({
          ...(params.bank ? { bank: params.bank } : {}),
          options: {
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.activeOnly !== undefined ? { activeOnly: params.activeOnly } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.offset !== undefined ? { offset: params.offset } : {}),
          },
        });
        return listDirectivesToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_directive",
      label: "Hindsight Get Directive",
      description: "Get a bank-owned Hindsight directive by ID.",
      parameters: Type.Object({
        directiveId: Type.String({ description: "Directive ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getDirective({
          directiveId: params.directiveId,
          ...(params.bank ? { bank: params.bank } : {}),
        });
        return getDirectiveToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_create_directive",
      label: "Hindsight Create Directive",
      description: "Create a bank-owned Hindsight directive (hard reflect rule).",
      parameters: Type.Object({
        name: Type.String({ description: "Human-readable directive name." }),
        content: Type.String({ description: "Directive text to inject into prompts." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        priority: Type.Optional(
          Type.Number({ description: "Higher priority directives are injected first." }),
        ),
        isActive: Type.Optional(Type.Boolean({ description: "Whether this directive is active." })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Directive tags." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.createDirective({
          ...(params.bank ? { bank: params.bank } : {}),
          request: {
            name: params.name,
            content: params.content,
            ...(params.priority !== undefined ? { priority: params.priority } : {}),
            ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
            ...(params.tags ? { tags: params.tags } : {}),
          },
        });
        return createDirectiveToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_update_directive",
      label: "Hindsight Update Directive",
      description: "Update a bank-owned Hindsight directive.",
      parameters: Type.Object({
        directiveId: Type.String({ description: "Directive ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        name: Type.Optional(
          Type.Union([Type.String(), Type.Null()], { description: "New directive name." }),
        ),
        content: Type.Optional(
          Type.Union([Type.String(), Type.Null()], { description: "New directive text." }),
        ),
        priority: Type.Optional(
          Type.Union([Type.Number(), Type.Null()], { description: "New priority." }),
        ),
        isActive: Type.Optional(
          Type.Union([Type.Boolean(), Type.Null()], { description: "New active status." }),
        ),
        tags: Type.Optional(
          Type.Union([Type.Array(Type.String()), Type.Null()], { description: "New tags." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.updateDirective({
          directiveId: params.directiveId,
          ...(params.bank ? { bank: params.bank } : {}),
          request: {
            ...(params.name !== undefined ? { name: params.name } : {}),
            ...(params.content !== undefined ? { content: params.content } : {}),
            ...(params.priority !== undefined ? { priority: params.priority } : {}),
            ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
            ...(params.tags !== undefined ? { tags: params.tags } : {}),
          },
        });
        return updateDirectiveToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_delete_directive",
      label: "Hindsight Delete Directive",
      description: "Delete a bank-owned Hindsight directive.",
      parameters: Type.Object({
        directiveId: Type.String({ description: "Directive ID." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        confirm: Type.Literal(true, {
          description: "Required destructive-action confirmation. Must be true.",
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.deleteDirective({
          directiveId: params.directiveId,
          ...(params.bank ? { bank: params.bank } : {}),
          confirm: params.confirm,
        });
        return deleteDirectiveToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_get_bank_template_schema",
      label: "Hindsight Get Bank Template Schema",
      description:
        "Fetch the Hindsight bank-template JSON Schema used to validate portable manifests.",
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.getBankTemplateSchema();
        return getBankTemplateSchemaToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_export_bank_template",
      label: "Hindsight Export Bank Template",
      description:
        "Export a portable Hindsight bank template manifest for reuse in another project or bank.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        outputFile: Type.Optional(
          Type.String({
            description:
              "Optional path to save the exported manifest JSON. Relative paths resolve against cwd.",
          }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.exportBankTemplate({
          ...(params.bank ? { bank: params.bank } : {}),
          cwd: ctx.cwd,
          ...(params.outputFile ? { outputFile: params.outputFile } : {}),
        });
        return exportBankTemplateToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_import",
      label: "Hindsight Import",
      description:
        "Import a historical Pi session JSONL file into Hindsight with deterministic document ID.",
      parameters: Type.Object({
        sessionFile: Type.Optional(
          Type.String({ description: "Pi session JSONL path. Defaults to current session file." }),
        ),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
        dryRun: Type.Optional(Type.Boolean({ description: "Preview import without writing." })),
        allLeaves: Type.Optional(
          Type.Boolean({ description: "Import or preview all branch leaves." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = params.sessionFile || ctx.sessionManager.getSessionFile?.();
        if (!sessionFile)
          throw new Error("No session file available. Pass sessionFile explicitly.");
        const result = await operations.importSession({
          sessionFile,
          cwd: ctx.cwd,
          ...(params.bank ? { bank: params.bank } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
          ...(params.allLeaves !== undefined
            ? { includeBranches: params.allLeaves ? "all-leaves" : "current-only" }
            : {}),
        });
        return importToolResponse(result);
      },
    }),
    defineCatalogTool({
      name: "hindsight_import_chat_transcript",
      label: "Hindsight Import Chat Transcript",
      description:
        "Import a chat transcript JSONL file into the configured user memory bank. Explicit separate path from Pi session import.",
      parameters: Type.Object({
        sourceFile: Type.String({ description: "Chat transcript JSONL path." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to configured user bank." }),
        ),
        dryRun: Type.Optional(Type.Boolean({ description: "Preview import without writing." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.importChatTranscript({
          sourceFile: params.sourceFile,
          cwd: ctx.cwd,
          ...(params.bank ? { bank: params.bank } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
        });
        return chatTranscriptImportToolResponse(result);
      },
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
          Type.Unsafe<import("./types.js").Budget>({
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
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.tagsMatch ? { tagsMatch: params.tagsMatch } : {}),
            ...(params.tagGroups
              ? { tagGroups: params.tagGroups as import("./types.js").HindsightTagGroup[] }
              : {}),
            ...(signal ? { signal } : {}),
          },
        );
        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
          details: { bankId },
        };
      },
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
