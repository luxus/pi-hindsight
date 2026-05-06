import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readImportCheckpoint } from "../extensions/import-checkpoint.js";

describe("import checkpoint", () => {
  it("accepts explicit import quality context allowed values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-checkpoint-"));
    const path = join(dir, "checkpoint.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        runId: "run",
        sourceFile: "session.jsonl",
        bankId: "bank",
        sessionId: "session",
        cwd: dir,
        includeBranches: "current-only",
        importMode: "curated",
        toolResults: "content",
        importQualityProfile: "strict",
        updateMode: "replace",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        documents: {
          doc: {
            documentId: "doc",
            leafId: "leaf",
            contentHash: "hash",
            messageCount: 1,
            importMode: "curated",
            toolResults: "summary",
            importQualityProfile: "compatible",
            projectionVersion: "curated-turns-v1",
            importProfile: "turns-12-bytes-80000",
            chunkIndex: 0,
            messageRange: { start: 0, end: 0 },
            status: "pending",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    await expect(readImportCheckpoint(path)).resolves.toMatchObject({
      toolResults: "content",
      importQualityProfile: "strict",
      documents: {
        doc: {
          toolResults: "summary",
          importQualityProfile: "compatible",
        },
      },
    });
  });

  it("rejects unsupported import quality context values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-checkpoint-"));
    const invalidRunPath = join(dir, "invalid-run.json");
    const invalidDocumentPath = join(dir, "invalid-document.json");
    const checkpoint = {
      version: 1,
      runId: "run",
      sourceFile: "session.jsonl",
      bankId: "bank",
      sessionId: "session",
      cwd: dir,
      includeBranches: "current-only",
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
      updateMode: "replace",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      documents: {
        doc: {
          documentId: "doc",
          leafId: "leaf",
          contentHash: "hash",
          messageCount: 1,
          importMode: "curated",
          toolResults: "summary",
          importQualityProfile: "strict",
          status: "completed",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(invalidRunPath, JSON.stringify({ ...checkpoint, toolResults: "all" }));
    writeFileSync(
      invalidDocumentPath,
      JSON.stringify({
        ...checkpoint,
        documents: {
          doc: { ...checkpoint.documents.doc, importQualityProfile: "loose" },
        },
      }),
    );

    await expect(readImportCheckpoint(invalidRunPath)).rejects.toThrow(
      "import checkpoint run fields are invalid",
    );
    await expect(readImportCheckpoint(invalidDocumentPath)).rejects.toThrow(
      "import checkpoint document doc is invalid",
    );
  });
});
