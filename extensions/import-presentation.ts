export type ImportDocumentSummaryResult = {
  documents: {
    updateMode: string;
    status: string;
    rawMessageCount?: number;
    messageCount?: number;
    rawBytes?: number;
    projectedBytes?: number;
    droppedToolResultCount?: number;
    droppedToolResultBytes?: number;
    topDroppedTools?: Array<{ name: string; count: number; bytes: number }>;
  }[];
  malformedLineCount?: number;
};

export type ImportSessionPresentationResult = ImportDocumentSummaryResult & {
  dryRun: boolean;
  messageCount: number;
  checkpointPath: string;
  manifestPath: string;
  documentId?: string;
};

export type ImportProjectPresentationResult = {
  dryRun: boolean;
  sessionFiles: string[];
  scanned: number;
  documentCount: number;
  messageCount: number;
  malformedLineCount: number;
};

export function importDocumentSummary(result: ImportDocumentSummaryResult): string {
  const modes = [...new Set(result.documents.map((document) => document.updateMode))].join(",");
  const statuses = [...new Set(result.documents.map((document) => document.status))].join(",");
  const malformed = result.malformedLineCount
    ? `; malformedLines=${result.malformedLineCount}`
    : "";
  const rawMessages = result.documents.reduce(
    (count, document) => count + (document.rawMessageCount ?? document.messageCount ?? 0),
    0,
  );
  const projectedMessages = result.documents.reduce(
    (count, document) => count + (document.messageCount ?? 0),
    0,
  );
  const droppedToolResults = result.documents.reduce(
    (count, document) => count + (document.droppedToolResultCount ?? 0),
    0,
  );
  const rawBytes = result.documents.reduce(
    (count, document) => count + (document.rawBytes ?? 0),
    0,
  );
  const projectedBytes = result.documents.reduce(
    (count, document) => count + (document.projectedBytes ?? 0),
    0,
  );
  const quality =
    rawMessages || droppedToolResults || rawBytes || projectedBytes
      ? `; projected=${projectedMessages}/${rawMessages || projectedMessages} messages; droppedToolResults=${droppedToolResults}; bytes=${projectedBytes}/${rawBytes}`
      : "";
  return `documents=${result.documents.length}; update=${modes || "n/a"}; status=${statuses || "n/a"}${malformed}${quality}`;
}

export function renderImportSessionMessage(
  result: ImportSessionPresentationResult,
  source: "default" | "current" | { file: string } = "default",
): string {
  const sourceLabel =
    source === "current"
      ? "current session"
      : typeof source === "object"
        ? `file=${source.file}`
        : "";
  const prefix = result.dryRun
    ? `Import preview${sourceLabel ? `: ${sourceLabel}` : ""}`
    : `Imported${sourceLabel ? ` ${sourceLabel}` : ""}`;
  return result.dryRun
    ? `${prefix}; messages=${result.messageCount}; ${importDocumentSummary(result)}; write=no; checkpoint=${result.checkpointPath}; manifest unchanged=${result.manifestPath}`
    : `${prefix}; messages=${result.messageCount}; ${importDocumentSummary(result)}; first=${result.documentId}${source === "default" ? `; manifest=${result.manifestPath}` : ""}`;
}

export function renderProjectImportMessage(result: ImportProjectPresentationResult): string {
  const summary = `sessions=${result.sessionFiles.length}/${result.scanned}; documents=${result.documentCount}; messages=${result.messageCount}; malformedLines=${result.malformedLineCount}`;
  return result.dryRun
    ? `Project import preview: ${summary}; write=no`
    : `Imported project sessions: ${summary}`;
}
