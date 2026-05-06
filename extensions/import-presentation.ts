export type ImportDocumentSummaryResult = {
  documents: {
    updateMode: string;
    status: string;
    rawMessageCount?: number;
    messageCount?: number;
    projectedMessageCount?: number;
    rawBytes?: number;
    projectedBytes?: number;
    droppedToolResultCount?: number;
    droppedToolResultBytes?: number;
    droppedTools?: Array<{ name: string; count: number; bytes: number }>;
    topDroppedTools?: Array<{ name: string; count: number; bytes: number }>;
    keptToolErrorCount?: number;
    keptToolErrorBytes?: number;
    classificationReasonCounts?: Record<string, number>;
    estimatedDocumentCount?: number;
    estimatedChunkCount?: number;
    importMode?: "curated" | "raw" | "forensic";
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

function sumReasonCounts(
  documents: ImportDocumentSummaryResult["documents"],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const document of documents) {
    for (const [reason, count] of Object.entries(document.classificationReasonCounts ?? {})) {
      counts[reason] = (counts[reason] ?? 0) + count;
    }
  }
  return counts;
}

function formatReasonCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter((entry): entry is [string, number] => entry[1] > 0)
    .sort(
      ([leftReason, leftCount], [rightReason, rightCount]) =>
        rightCount - leftCount || leftReason.localeCompare(rightReason),
    )
    .map(([reason, count]) => `${reason}:${count}`)
    .join(",");
}

function formatTopDroppedTools(documents: ImportDocumentSummaryResult["documents"]): string {
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const document of documents) {
    for (const tool of document.droppedTools ?? document.topDroppedTools ?? []) {
      const current = totals.get(tool.name) ?? { count: 0, bytes: 0 };
      totals.set(tool.name, {
        count: current.count + tool.count,
        bytes: current.bytes + tool.bytes,
      });
    }
  }
  return [...totals]
    .map(([name, value]) => ({ name, ...value }))
    .sort(
      (left, right) =>
        right.bytes - left.bytes || right.count - left.count || left.name.localeCompare(right.name),
    )
    .slice(0, 3)
    .map((tool) => `${tool.name}:${tool.count}`)
    .join(",");
}

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
    (count, document) => count + (document.projectedMessageCount ?? document.messageCount ?? 0),
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
  const keptErrors = result.documents.reduce(
    (count, document) => count + (document.keptToolErrorCount ?? 0),
    0,
  );
  const estimatedChunks = result.documents.reduce(
    (count, document) => count + (document.estimatedChunkCount ?? 0),
    0,
  );
  const importModes = [
    ...new Set(result.documents.map((document) => document.importMode).filter(Boolean)),
  ].join(",");
  const reasonCounts = formatReasonCounts(sumReasonCounts(result.documents));
  const topDroppedTools = formatTopDroppedTools(result.documents);
  const forensicWarning = importModes.includes("forensic")
    ? "; WARNING forensic mode preserves recalled memory blocks for audit-only use"
    : "";
  const qualityDetails = `${reasonCounts ? `; reasons=${reasonCounts}` : ""}${topDroppedTools ? `; topDroppedTools=${topDroppedTools}` : ""}`;
  const quality =
    rawMessages || droppedToolResults || rawBytes || projectedBytes
      ? `; mode=${importModes || "unknown"}; projected=${projectedMessages}/${rawMessages || projectedMessages} messages; droppedToolResults=${droppedToolResults}; keptToolErrors=${keptErrors}; estimatedChunks=${estimatedChunks}; bytes=${projectedBytes}/${rawBytes}${qualityDetails}${forensicWarning}`
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
