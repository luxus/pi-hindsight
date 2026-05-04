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
export type ExportBankTemplateToolResult = Awaited<
  ReturnType<MemoryOperations["exportBankTemplate"]>
>;
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

export function importToolResponse(result: ImportToolResult): ToolTextResponse<ImportToolResult> {
  const documentLabel = `document${result.documents.length === 1 ? "" : "s"}`;
  const text = result.dryRun
    ? `Import preview: ${result.messageCount} messages would write ${result.documents.length} ${documentLabel} to ${result.bankId}. First document: ${result.documentId}. Manifest unchanged: ${result.manifestPath}.`
    : `Imported ${result.messageCount} messages into ${result.bankId} as ${result.documentId}. Manifest: ${result.manifestPath}.`;
  return { content: [{ type: "text", text }], details: result };
}

function manifestCounts(manifest: unknown): {
  bankOverrideCount: number;
  mentalModelCount: number;
  directiveCount: number;
} {
  if (typeof manifest !== "object" || !manifest || Array.isArray(manifest)) {
    return { bankOverrideCount: 0, mentalModelCount: 0, directiveCount: 0 };
  }
  const record = manifest as Record<string, unknown>;
  const bank = record.bank;
  return {
    bankOverrideCount:
      typeof bank === "object" && bank !== null && !Array.isArray(bank)
        ? Object.keys(bank).length
        : 0,
    mentalModelCount: Array.isArray(record.mental_models) ? record.mental_models.length : 0,
    directiveCount: Array.isArray(record.directives) ? record.directives.length : 0,
  };
}

export function exportBankTemplateToolResponse(
  result: ExportBankTemplateToolResult,
): ToolTextResponse<ExportBankTemplateToolResult> {
  const counts = manifestCounts(result.manifest);
  return {
    content: [
      {
        type: "text",
        text: [
          `Exported bank template from ${result.bankId}.`,
          `Bank overrides: ${counts.bankOverrideCount}; mental models: ${counts.mentalModelCount}; directives: ${counts.directiveCount}`,
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
