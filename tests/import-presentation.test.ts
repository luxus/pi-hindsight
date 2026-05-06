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
            topDroppedTools: [
              { name: "read", count: 2, bytes: 900 },
              { name: "grep", count: 1, bytes: 100 },
            ],
            classificationReasonCounts: {
              "tool-filter-excluded": 2,
              "tool-error-kept": 1,
              "assistant-text": 1,
            },
            importMode: "forensic",
          },
        ],
      }),
    ).toContain(
      "mode=forensic; projected=3/5 messages; droppedToolResults=2; keptToolErrors=1; estimatedChunks=1; bytes=400/1000; reasons=tool-filter-excluded:2,assistant-text:1,tool-error-kept:1; topDroppedTools=read:2,grep:1; WARNING forensic mode preserves recalled memory blocks for audit-only use",
    );
  });

  it("aggregates complete dropped-tool totals before slicing preview output", () => {
    const documents = [0, 1].map((chunk) => ({
      updateMode: "replace",
      status: "pending",
      rawMessageCount: 10,
      projectedMessageCount: 5,
      rawBytes: 10_000,
      projectedBytes: 1_000,
      droppedToolResultCount: 6,
      keptToolErrorCount: 0,
      estimatedChunkCount: 1,
      importMode: "curated" as const,
      topDroppedTools: [
        { name: `one-off-${chunk}-1`, count: 1, bytes: 1_000 },
        { name: `one-off-${chunk}-2`, count: 1, bytes: 900 },
        { name: `one-off-${chunk}-3`, count: 1, bytes: 800 },
        { name: `one-off-${chunk}-4`, count: 1, bytes: 700 },
        { name: `one-off-${chunk}-5`, count: 1, bytes: 600 },
      ],
      droppedTools: [
        { name: `one-off-${chunk}-1`, count: 1, bytes: 1_000 },
        { name: `one-off-${chunk}-2`, count: 1, bytes: 900 },
        { name: `one-off-${chunk}-3`, count: 1, bytes: 800 },
        { name: `one-off-${chunk}-4`, count: 1, bytes: 700 },
        { name: `one-off-${chunk}-5`, count: 1, bytes: 600 },
        { name: "recurring-medium", count: 3, bytes: 550 },
      ],
    }));

    expect(importDocumentSummary({ documents })).toContain(
      "topDroppedTools=recurring-medium:6,one-off-0-1:1,one-off-1-1:1",
    );
  });
});
