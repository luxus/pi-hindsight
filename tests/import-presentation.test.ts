import { describe, expect, it } from "vitest";
import { importDocumentSummary } from "../extensions/import-presentation.js";

describe("import presentation", () => {
  it("renders import quality metrics and forensic warning", () => {
    expect(
      importDocumentSummary({
        documents: [
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 5,
            projectedMessageCount: 3,
            rawBytes: 1000,
            projectedBytes: 400,
            droppedToolResultCount: 2,
            keptToolErrorCount: 1,
            estimatedChunkCount: 1,
            importMode: "forensic",
          },
        ],
      }),
    ).toContain(
      "mode=forensic; projected=3/5 messages; droppedToolResults=2; keptToolErrors=1; estimatedChunks=1; bytes=400/1000; WARNING forensic mode preserves recalled memory blocks for audit-only use",
    );
  });
});
