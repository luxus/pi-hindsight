import { Type } from "typebox";
import { defineTool, type ExtensionAPI, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { importCommandOperations } from "./command-imports.js";
import { maintenanceCommandOperations } from "./command-maintenance.js";
import { sessionCommandOperations } from "./command-session.js";
import type { MemoryOperationsDeps } from "./memory-operation-service.js";
import { createMemoryOperations } from "./memory-operation-service.js";
import { getSessionFile } from "./session.js";
import { runHindsightSetupTui } from "./setup-tui.js";
import {
  configureToolResponse,
  deleteDocumentToolResponse,
  exportBankTemplateToolResponse,
  gatewayImportToolResponse,
  getBankConfigToolResponse,
  getBankTemplateSchemaToolResponse,
  importToolResponse,
  resetBankConfigToolResponse,
  retainReceiptListToolResponse,
  retainToolResponse,
  routeMemoryToolResponse,
} from "./tool-presenters.js";

export type ToolOperation = Parameters<ExtensionAPI["registerTool"]>[0];

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
        queryTimestamp: Type.Optional(
          Type.String({ description: "Optional ISO timestamp for time-scoped recall." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const sessionFile = ctx.sessionManager.getSessionFile?.();
        const { bankId, result } = await operations.recall(
          ctx.cwd,
          params.query,
          params.bank,
          sessionFile,
          params.queryTimestamp,
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
          Type.Array(
            Type.Object({
              text: Type.String(),
              type: Type.Optional(Type.String()),
            }),
          ),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
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
          Type.Array(
            Type.Object({
              text: Type.String(),
              type: Type.Optional(Type.String()),
            }),
          ),
        ),
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
      name: "hindsight_reset_bank_config",
      label: "Hindsight Reset Bank Config",
      description: "Reset Hindsight bank config overrides for a selected bank.",
      parameters: Type.Object({
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to project bank." }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.resetBankConfig(params.bank ? { bank: params.bank } : {});
        return resetBankConfigToolResponse(result);
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
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.exportBankTemplate(
          params.bank ? { bank: params.bank } : {},
        );
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
      name: "hindsight_import_gateway",
      label: "Hindsight Import Gateway Transcript",
      description:
        "Import a gateway/chat transcript JSONL file into the configured user memory bank. Explicit separate path from Pi session import.",
      parameters: Type.Object({
        sourceFile: Type.String({ description: "Gateway transcript JSONL path." }),
        bank: Type.Optional(
          Type.String({ description: "Optional bank id. Defaults to configured user bank." }),
        ),
        dryRun: Type.Optional(Type.Boolean({ description: "Preview import without writing." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const result = await operations.importGatewayTranscript({
          sourceFile: params.sourceFile,
          cwd: ctx.cwd,
          ...(params.bank ? { bank: params.bank } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
        });
        return gatewayImportToolResponse(result);
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
        responseSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        useCwd(ctx.cwd);
        const { bankId, result } = await operations.reflect(
          ctx.cwd,
          params.query,
          params.context,
          params.bank,
          params.responseSchema,
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
