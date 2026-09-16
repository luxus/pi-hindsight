import { describe, expect, it } from "vitest";
import {
  importDocumentSummary,
  renderProjectImportMessage,
  renderImportSessionMessage,
} from "../extensions/imports/import-presentation.js";

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
      "mode=forensic; projected=3/5 messages; droppedToolResults=2; keptToolErrors=1; estimatedChunks=1; bytes=400/1000; keptSignals=assistant:1,tool-errors:1; droppedNoise=successful-tools:2; reasons=tool-filter-excluded:2,assistant-text:1,tool-error-kept:1; topDroppedTools=read:2,grep:1; WARNING forensic mode preserves recalled memory blocks for audit-only use",
    );
  });

  it("renders concise kept signal and dropped noise categories in single-session previews", () => {
    expect(
      renderImportSessionMessage({
        dryRun: true,
        messageCount: 21,
        checkpointPath: "/tmp/checkpoint.json",
        manifestPath: "/tmp/manifest.json",
        documents: [
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 21,
            projectedMessageCount: 5,
            rawBytes: 2100,
            projectedBytes: 500,
            droppedToolResultCount: 15,
            keptToolErrorCount: 1,
            estimatedChunkCount: 1,
            importMode: "curated",
            classificationReasonCounts: {
              "user-text": 2,
              "assistant-text": 1,
              "tool-error-kept": 1,
              "message-kept": 1,
              "successful-tool-output": 3,
              "tool-filter-excluded": 2,
              "recalled-memory": 1,
              "ui-noise": 2,
              "process-noise": 1,
              "oversized-output": 1,
              "repeated-output": 4,
              "tool-result-empty": 1,
              "empty-projection": 1,
            },
          },
        ],
      }),
    ).toContain(
      "keptSignals=user:2,assistant:1,tool-errors:1,workflow:1; droppedNoise=successful-tools:5,recalled-memory:1,ui/process:3,oversized/repeated:5,empty:2; reasons=",
    );
  });

  it("renders skip reasons for skipped empty curated documents", () => {
    expect(
      importDocumentSummary({
        documents: [
          {
            updateMode: "replace",
            status: "skipped",
            rawMessageCount: 0,
            projectedMessageCount: 0,
            rawBytes: 0,
            projectedBytes: 0,
            droppedToolResultCount: 0,
            keptToolErrorCount: 0,
            estimatedChunkCount: 1,
            importMode: "curated",
            skipReason: "empty-curated-projection",
          },
        ],
      }),
    ).toContain("skipReasons=empty-curated-projection");
  });

  it("renders queue admission counts with deterministic code-point ordering", () => {
    expect(
      importDocumentSummary({
        documents: [
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 1,
            projectedMessageCount: 1,
            queueAdmission: "\u{1f600}" as "would-enqueue",
          },
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 1,
            projectedMessageCount: 1,
            queueAdmission: "\ue000" as "would-enqueue",
          },
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 1,
            projectedMessageCount: 1,
            queueAdmission: "a" as "would-enqueue",
          },
        ],
      }),
    ).toContain("admission=a:1,\ue000:1,\u{1f600}:1");
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

  it("aggregates multi-session project import quality metrics in preview and import output", () => {
    const imported = [
      {
        documents: [
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 4,
            projectedMessageCount: 2,
            rawBytes: 1_000,
            projectedBytes: 200,
            droppedToolResultCount: 2,
            keptToolErrorCount: 1,
            estimatedChunkCount: 1,
            importMode: "curated" as const,
            importQualityProfile: "strict" as const,
            queueAdmission: "would-enqueue" as const,
            droppedTools: [
              { name: "read", count: 1, bytes: 500 },
              { name: "bash", count: 1, bytes: 200 },
            ],
            classificationReasonCounts: {
              "tool-filter-excluded": 2,
              "assistant-text": 1,
            },
          },
        ],
      },
      {
        documents: [
          {
            updateMode: "replace",
            status: "pending",
            rawMessageCount: 3,
            projectedMessageCount: 2,
            rawBytes: 500,
            projectedBytes: 300,
            droppedToolResultCount: 1,
            keptToolErrorCount: 1,
            estimatedChunkCount: 2,
            importMode: "curated" as const,
            importQualityProfile: "strict" as const,
            queueAdmission: "quarantined" as const,
            droppedTools: [
              { name: "read", count: 2, bytes: 100 },
              { name: "grep", count: 1, bytes: 50 },
            ],
            classificationReasonCounts: {
              "tool-filter-excluded": 1,
              "tool-error-kept": 1,
            },
          },
        ],
      },
    ];
    const base = {
      sessionFiles: ["/sessions/a.jsonl", "/sessions/b.jsonl"],
      scanned: 3,
      documentCount: 2,
      messageCount: 7,
      malformedLineCount: 1,
      imported,
    };
    const quality =
      "mode=curated; profile=strict; projected=4/7 messages; droppedToolResults=3; keptToolErrors=2; estimatedChunks=3; bytes=500/1500; keptSignals=assistant:1,tool-errors:1; droppedNoise=successful-tools:3; reasons=tool-filter-excluded:3,assistant-text:1,tool-error-kept:1; topDroppedTools=read:3,bash:1,grep:1; admission=quarantined:1,would-enqueue:1";

    expect(renderProjectImportMessage({ ...base, dryRun: true })).toBe(
      `Project import preview: sessions=2/3; documents=2; messages=7; malformedLines=1; ${quality}; write=no`,
    );
    expect(renderProjectImportMessage({ ...base, dryRun: false })).toBe(
      `Imported project sessions: sessions=2/3; documents=2; messages=7; malformedLines=1; ${quality}`,
    );
  });
});
