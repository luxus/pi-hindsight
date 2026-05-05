import {
  bankConfigOverrideSummaryLines,
  exportedBankTemplateSummaryLines,
} from "./bank-settings-presenter.js";
import type { MemoryOperations } from "./memory-operation-service.js";

type ToolTextResponse<Details> = {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
};

export type RetainToolResult = Awaited<ReturnType<MemoryOperations["retainExplicit"]>>;
export type RouteMemoryToolResult = ReturnType<MemoryOperations["routeMemory"]>;
export type DeleteDocumentToolResult = Awaited<ReturnType<MemoryOperations["deleteDocument"]>>;
export type ConfigureToolResult = Awaited<ReturnType<MemoryOperations["configure"]>>;
export type ImportToolResult = Awaited<ReturnType<MemoryOperations["importSession"]>>;
export type GatewayImportToolResult = Awaited<
  ReturnType<MemoryOperations["importGatewayTranscript"]>
>;
export type GetBankTemplateSchemaToolResult = Awaited<
  ReturnType<MemoryOperations["getBankTemplateSchema"]>
>;
export type ExportBankTemplateToolResult = Awaited<
  ReturnType<MemoryOperations["exportBankTemplate"]>
>;
export type GetBankConfigToolResult = Awaited<ReturnType<MemoryOperations["getBankConfig"]>>;
export type ResetBankConfigToolResult = Awaited<ReturnType<MemoryOperations["resetBankConfig"]>>;
export type RetainReceiptListResult = Awaited<ReturnType<MemoryOperations["listRetainReceipts"]>>;

export function retainToolResponse(result: RetainToolResult): ToolTextResponse<RetainToolResult> {
  const deadLetterStatus = result.deadLettered
    ? ` ${result.deadLettered} job${result.deadLettered === 1 ? "" : "s"} moved to dead-letter queue; run /hindsight to inspect.`
    : "";
  const text =
    result.remaining > 0
      ? `Queued for ${result.bankId}; ${result.remaining} job${result.remaining === 1 ? "" : "s"} pending.${deadLetterStatus}`
      : `Retained in ${result.bankId} as ${result.documentId}.${deadLetterStatus}`;
  return { content: [{ type: "text", text }], details: result };
}

export function routeMemoryToolResponse(
  result: RouteMemoryToolResult,
): ToolTextResponse<RouteMemoryToolResult> {
  const targetText = result.targets.length
    ? result.targets
        .map(
          (target) =>
            `${target.bankRole}:${target.bankId} tags=${target.tags.join(",") || "none"} ${target.willWrite ? "will-write" : "preview-only"}`,
        )
        .join("; ")
    : "none";
  const writeText = result.writes.length ? result.writes.join(",") : "none";
  const safetyText = result.safetyNotes.length ? result.safetyNotes.join("; ") : "none";
  return {
    content: [
      {
        type: "text",
        text: [
          `Route ${result.route} confidence=${result.confidence}; ${result.reason}`,
          `Targets: ${targetText}`,
          `Writes now: ${writeText}`,
          `Safety: ${safetyText}`,
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function deleteDocumentToolResponse(
  result: DeleteDocumentToolResult,
): ToolTextResponse<DeleteDocumentToolResult> {
  return {
    content: [
      {
        type: "text",
        text: `Deleted document ${result.documentId} from ${result.bankId}.`,
      },
    ],
    details: result,
  };
}

export function configureToolResponse(
  result: ConfigureToolResult,
): ToolTextResponse<{ path: string; projectBankId: string }> {
  return {
    content: [
      {
        type: "text",
        text: `Wrote ${result.path}\nProject bank: ${result.projectBankId}\nRun /hindsight to verify.`,
      },
    ],
    details: { path: result.path, projectBankId: result.projectBankId },
  };
}

export function gatewayImportToolResponse(
  result: GatewayImportToolResult,
): ToolTextResponse<GatewayImportToolResult> {
  const dropped = result.droppedEventTypes.length
    ? result.droppedEventTypes.map((event) => `${event.type}:${event.count}`).join(", ")
    : "none";
  const text = result.skipped
    ? `Gateway import skipped: ${result.skipReason}; dropped=${result.droppedEventCount} (${dropped}); malformed=${result.malformedLineCount}.`
    : result.dryRun
      ? `Gateway import preview: kept=${result.keptEventCount}; turns=${result.retainedTurnCount}; dropped=${result.droppedEventCount} (${dropped}); malformed=${result.malformedLineCount}; bank=${result.bankId}; document=${result.documentId}.`
      : `Imported gateway transcript into ${result.bankId} as ${result.documentId}; kept=${result.keptEventCount}; dropped=${result.droppedEventCount}.`;
  return { content: [{ type: "text", text }], details: result };
}

export function importToolResponse(result: ImportToolResult): ToolTextResponse<ImportToolResult> {
  const documentLabel = `document${result.documents.length === 1 ? "" : "s"}`;
  const text = result.dryRun
    ? `Import preview: ${result.messageCount} messages would write ${result.documents.length} ${documentLabel} to ${result.bankId}. First document: ${result.documentId}. Manifest unchanged: ${result.manifestPath}.`
    : `Imported ${result.messageCount} messages into ${result.bankId} as ${result.documentId}. Manifest: ${result.manifestPath}.`;
  return { content: [{ type: "text", text }], details: result };
}

function schemaSummary(schema: unknown): string {
  if (typeof schema !== "object" || !schema || Array.isArray(schema))
    return "Schema fields: unavailable";
  const record = schema as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "Bank template schema";
  const properties = record.properties;
  const propertyCount =
    typeof properties === "object" && properties && !Array.isArray(properties)
      ? Object.keys(properties).length
      : 0;
  return `${title}; top-level fields: ${propertyCount}`;
}

export function getBankTemplateSchemaToolResponse(
  result: GetBankTemplateSchemaToolResult,
): ToolTextResponse<GetBankTemplateSchemaToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          "Fetched Hindsight bank template JSON Schema.",
          schemaSummary(result.schema),
          JSON.stringify(result.schema, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function getBankConfigToolResponse(
  result: GetBankConfigToolResult,
): ToolTextResponse<GetBankConfigToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Read bank config for ${result.bankId}.`,
          bankConfigOverrideSummaryLines(result.result).join("; "),
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function resetBankConfigToolResponse(
  result: ResetBankConfigToolResult,
): ToolTextResponse<ResetBankConfigToolResult> {
  const before = result.before
    ? bankConfigOverrideSummaryLines(result.before).join("; ")
    : "unavailable";
  const after = result.after
    ? bankConfigOverrideSummaryLines(result.after).join("; ")
    : "unavailable";
  return {
    content: [
      {
        type: "text",
        text: [
          `Reset bank config overrides for ${result.bankId}.`,
          `Before: ${before}`,
          `After: ${after}`,
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function exportBankTemplateToolResponse(
  result: ExportBankTemplateToolResult,
): ToolTextResponse<ExportBankTemplateToolResult> {
  const summary = exportedBankTemplateSummaryLines(result.manifest).join("; ");
  return {
    content: [
      {
        type: "text",
        text: [
          `Exported bank template from ${result.bankId}.`,
          summary,
          JSON.stringify(result.manifest, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function retainReceiptListToolResponse(
  result: RetainReceiptListResult,
): ToolTextResponse<RetainReceiptListResult> {
  const lines = result.map(
    (receipt, index) =>
      `${index + 1}. ${receipt.createdAt} ${receipt.bankId} ${receipt.documentId} (${receipt.updateMode})`,
  );
  return {
    content: [{ type: "text", text: lines.length ? lines.join("\n") : "No retain receipts." }],
    details: result,
  };
}
