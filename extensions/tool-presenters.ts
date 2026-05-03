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
  return {
    content: [
      {
        type: "text",
        text: `Route ${result.route} confidence=${result.confidence}; ${result.reason}`,
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
