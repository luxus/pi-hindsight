import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { RetainJob, UpdateMode } from "../extensions/types.js";
import {
  discoverProjectSessionFiles,
  importPiSession,
  importProjectSessions,
  parseImportSessionJsonl,
  parsePiSessionJsonl,
  selectImportBranches,
} from "../extensions/imports/import-sessions.js";
import { readImportCheckpoint } from "../extensions/imports/import-plan.js";
import { hashImportContent, readImportManifest } from "../extensions/imports/import-plan.js";
import { enqueueRetainJob, readRetainQueue, resolveQueuePath } from "../extensions/queue/queue.js";
import { stableSessionId } from "../extensions/utils/session.js";
import { setNextSessionRetainMode } from "../extensions/utils/session-memory-meta.js";

const equivalentPathVariants = [
  { name: "same path", sessionCwd: (project: string) => project },
  { name: "trailing separator", sessionCwd: (project: string) => `${project}${sep}` },
  { name: "raw dot segment", sessionCwd: (project: string) => `${project}${sep}.${sep}` },
  {
    name: "raw parent traversal",
    sessionCwd: (project: string) => `${project}${sep}nested${sep}..`,
  },
  { name: "resolved path", sessionCwd: (project: string) => resolve(project) },
];

function projectSessionCheckpointPath(basePath: string, sessionFile: string): string {
  return `${basePath}.${hashImportContent(sessionFile).slice(0, 12)}.json`;
}

function queuedImportRetainJob(args: {
  id: string;
  bankId?: string;
  documentId: string;
  updateMode?: UpdateMode;
  content?: string;
  context?: string;
  sourceFile: string;
  cwd: string;
  sessionId: string;
  leafId: string;
  contentHash: string;
  includeBranches?: "current-only" | "all-leaves";
  importMode?: "curated" | "raw" | "forensic";
  toolResults?: "errors-only" | "summary" | "content";
  importQualityProfile?: "compatible" | "strict" | undefined;
  projectionVersion?: string | undefined;
  importProfile?: string | undefined;
  chunkIndex?: number | undefined;
  messageRange?: { start: number; end: number } | undefined;
}): RetainJob {
  return {
    id: args.id,
    bankId: args.bankId ?? "bank",
    createdAt: "now",
    documentId: args.documentId,
    updateMode: args.updateMode ?? "replace",
    item: {
      content: args.content ?? "queued import content",
      context: args.context ?? "queued import context",
      metadata: {
        source: "pi-hindsight",
        retainSource: "import",
        pi_session_file: args.sourceFile,
        imported: "true",
        cwd: args.cwd,
        session_id: args.sessionId,
        branch_leaf_id: args.leafId,
        import_mode: args.importMode ?? "curated",
        ...(args.importQualityProfile ? { import_quality_profile: args.importQualityProfile } : {}),
        ...(args.projectionVersion ? { projection_version: args.projectionVersion } : {}),
        ...(args.importProfile ? { import_profile: args.importProfile } : {}),
        ...(args.chunkIndex !== undefined ? { chunk_index: String(args.chunkIndex) } : {}),
        ...(args.messageRange
          ? {
              message_range_start: String(args.messageRange.start),
              message_range_end: String(args.messageRange.end),
            }
          : {}),
        content_hash: args.contentHash,
        include_branches: args.includeBranches ?? "current-only",
        tool_results: args.toolResults ?? "errors-only",
      },
    },
    retries: 0,
  };
}

describe("Pi session import", () => {
  it("parses message entries from Pi JSONL", () => {
    const parsed = parsePiSessionJsonl(
      [
        JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" }),
        JSON.stringify({
          type: "message",
          id: "1",
          parentId: null,
          timestamp: "t",
          message: { role: "user", content: "hi" },
        }),
        "{not json}",
        JSON.stringify({ type: "custom", data: {} }),
      ].join("\n"),
    );
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.malformedLineCount).toBe(1);
    expect(parsed.messages[0]).toMatchObject({ id: "1", role: "user", content: "hi" });
  });

  it("previews curated import metrics that drop non-error tool results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-curated-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-curated", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "u1",
          parentId: null,
          message: { role: "user", content: "remember architecture", timestamp: 1 },
        }),
        JSON.stringify({
          type: "message",
          id: "tool1",
          parentId: "u1",
          message: { role: "toolResult", name: "read", content: "huge successful file output" },
        }),
        JSON.stringify({
          type: "message",
          id: "tool2",
          parentId: "tool1",
          message: { role: "toolResult", name: "bash", isError: true, content: "build failed" },
        }),
        JSON.stringify({
          type: "message",
          id: "tool3",
          parentId: "tool2",
          message: { role: "toolResult", content: "other successful output" },
        }),
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "tool3",
          message: {
            role: "assistant",
            content: "decision recorded",
            timestamp: "2026-01-02T03:04:05.000Z",
          },
        }),
      ].join("\n"),
    );

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 5,
      messageCount: 5,
      projectedMessageCount: 3,
      droppedToolResultCount: 2,
      keptToolErrorCount: 1,
      keptToolErrorBytes: expect.any(Number),
      estimatedDocumentCount: 1,
      estimatedChunkCount: expect.any(Number),
      importMode: "curated",
      topDroppedTools: expect.arrayContaining([
        { name: "read", count: 1, bytes: expect.any(Number) },
        { name: "unknown", count: 1, bytes: expect.any(Number) },
      ]),
      wouldWrite: false,
    });
  });

  it("skips curated import documents with zero projected messages after noise filtering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-empty-curated-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-empty-curated", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "tool1",
          parentId: null,
          message: { role: "toolResult", name: "read", content: "successful output only" },
        }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: { retain, recall: async () => [], reflect: async () => ({}) },
    });
    const checkpoint = await readImportCheckpoint(result.checkpointPath);
    const manifest = await readImportManifest(result.manifestPath);

    expect(retain).not.toHaveBeenCalled();
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      documentId:
        "pi-import:session-empty-curated:leaf:tool1:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0",
      rawMessageCount: 1,
      messageCount: 1,
      projectedMessageCount: 0,
      droppedToolResultCount: 1,
      importMode: "curated",
      status: "skipped",
      skipReason: "empty-curated-projection",
      wouldWrite: false,
    });
    expect(checkpoint?.documents[result.documents[0]!.documentId]).toMatchObject({
      documentId: result.documents[0]!.documentId,
      messageCount: 1,
      importMode: "curated",
      projectionVersion: "curated-turns-v1",
      status: "skipped",
      skipReason: "empty-curated-projection",
    });
    expect(manifest.imports).toEqual({});
  });

  it("preserves explicit raw and forensic empty-source imports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-empty-raw-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      JSON.stringify({ type: "session", id: "session-empty-source", cwd: dir }),
    );
    const rawRetain = vi.fn(async () => undefined);
    const forensicRetain = vi.fn(async () => undefined);

    const raw = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: { ...DEFAULT_CONFIG, import: { ...DEFAULT_CONFIG.import, mode: "raw" } },
      client: { retain: rawRetain, recall: async () => [], reflect: async () => ({}) },
    });
    const forensic = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: { ...DEFAULT_CONFIG, import: { ...DEFAULT_CONFIG.import, mode: "forensic" } },
      client: { retain: forensicRetain, recall: async () => [], reflect: async () => ({}) },
    });

    expect(rawRetain).toHaveBeenCalledTimes(1);
    expect(forensicRetain).toHaveBeenCalledTimes(1);
    expect(raw.documents[0]).toMatchObject({
      rawMessageCount: 0,
      projectedMessageCount: 0,
      importMode: "raw",
      status: "completed",
      wouldWrite: true,
    });
    expect(raw.documents[0]).not.toHaveProperty("skipReason");
    expect(forensic.documents[0]).toMatchObject({
      rawMessageCount: 0,
      projectedMessageCount: 0,
      importMode: "forensic",
      status: "completed",
      wouldWrite: true,
    });
    expect(forensic.documents[0]).not.toHaveProperty("skipReason");
  }, 15_000);

  it("chunks curated import documents by user turns with deterministic IDs and checkpoint metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-chunks-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-chunks", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "u1",
          parentId: null,
          message: { role: "user", content: "one" },
        }),
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "u1",
          message: { role: "assistant", content: "answer one" },
        }),
        JSON.stringify({
          type: "message",
          id: "u2",
          parentId: "a1",
          message: { role: "user", content: "two" },
        }),
        JSON.stringify({
          type: "message",
          id: "a2",
          parentId: "u2",
          message: { role: "assistant", content: "answer two" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    const config = {
      ...DEFAULT_CONFIG,
      import: { ...DEFAULT_CONFIG.import, turnsPerDocument: 1, maxDocumentBytes: 100_000 },
    };

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });
    const checkpoint = await readImportCheckpoint(result.checkpointPath);
    const manifest = await readImportManifest(result.manifestPath);

    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((document) => document.documentId)).toEqual([
      "pi-import:session-chunks:leaf:a2:turns-1-bytes-100000:curated-turns-v1:chunk-0-0-1",
      "pi-import:session-chunks:leaf:a2:turns-1-bytes-100000:curated-turns-v1:chunk-1-2-3",
    ]);
    expect(result.documents[0]).toMatchObject({
      messageCount: 2,
      importMode: "curated",
      projectionVersion: "curated-turns-v1",
      importProfile: "turns-1-bytes-100000",
      chunkIndex: 0,
      messageRange: { start: 0, end: 1 },
      estimatedDocumentCount: 2,
    });
    expect(Object.values(checkpoint?.documents ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId:
            "pi-import:session-chunks:leaf:a2:turns-1-bytes-100000:curated-turns-v1:chunk-1-2-3",
          importMode: "curated",
          projectionVersion: "curated-turns-v1",
          importProfile: "turns-1-bytes-100000",
          chunkIndex: 1,
          messageRange: { start: 2, end: 3 },
        }),
      ]),
    );
    expect(
      manifest.imports[
        "pi-import:session-chunks:leaf:a2:turns-1-bytes-100000:curated-turns-v1:chunk-0-0-1"
      ],
    ).toMatchObject({
      importMode: "curated",
      projectionVersion: "curated-turns-v1",
      chunkIndex: 0,
      messageRange: { start: 0, end: 1 },
    });
    expect(calls).toHaveLength(2);
  });

  it("records strict curated quality context in pending and completed checkpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-quality-checkpoint-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-quality-checkpoint", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "u1",
          parentId: null,
          message: { role: "user", content: "inspect checkpoint quality" },
        }),
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "u1",
          message: { role: "assistant", content: "using tool" },
        }),
        JSON.stringify({
          type: "message",
          id: "tool1",
          parentId: "a1",
          message: { role: "toolResult", name: "custom-tool", content: "useful short output" },
        }),
      ].join("\n"),
    );
    const config = {
      ...DEFAULT_CONFIG,
      import: {
        ...DEFAULT_CONFIG.import,
        qualityProfile: "strict" as const,
        toolResults: "summary" as const,
      },
    };
    const documentId =
      "pi-import:session-quality-checkpoint:leaf:tool1:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-2";
    let pendingCheckpointSeen = false;

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config,
      client: {
        retain: async () => {
          const checkpoint = await readImportCheckpoint(
            join(dir, ".pi/hindsight/import-checkpoint.json"),
          );
          expect(checkpoint).toMatchObject({
            importMode: "curated",
            toolResults: "summary",
            importQualityProfile: "strict",
          });
          expect(checkpoint?.documents[documentId]).toMatchObject({
            status: "pending",
            importMode: "curated",
            toolResults: "summary",
            importQualityProfile: "strict",
            projectionVersion: "curated-turns-v1",
            importProfile: "turns-12-bytes-80000",
            chunkIndex: 0,
            messageRange: { start: 0, end: 2 },
          });
          pendingCheckpointSeen = true;
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(pendingCheckpointSeen).toBe(true);
    const completedCheckpoint = await readImportCheckpoint(result.checkpointPath);
    expect(completedCheckpoint?.documents[documentId]).toMatchObject({
      status: "completed",
      toolResults: "summary",
      importQualityProfile: "strict",
    });
    const manifest = await readImportManifest(result.manifestPath);
    expect(manifest.imports[documentId]).toMatchObject({
      toolResults: "summary",
      importQualityProfile: "strict",
    });
  });

  it("keeps retained content, manifest, and checkpoint provenance aligned for strict single-session imports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-provenance-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          id: "session-provenance",
          cwd: `${dir}${sep}.${sep}`,
        }),
        JSON.stringify({
          type: "message",
          id: "u-original",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "user",
            id: "spoof-user",
            parentId: "spoof-parent",
            timestamp: "spoof-time",
            content: "remember provenance",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "a-original",
          parentId: "u-original",
          timestamp: "2026-01-01T00:01:00.000Z",
          message: {
            role: "assistant",
            id: "spoof-assistant",
            parentId: "spoof-parent",
            timestamp: "spoof-time",
            content: "kept answer",
          },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    const config = {
      ...DEFAULT_CONFIG,
      import: {
        ...DEFAULT_CONFIG.import,
        qualityProfile: "strict" as const,
        toolResults: "summary" as const,
      },
    };

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    const documentId =
      "pi-import:session-provenance:leaf:a-original:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1";
    expect(result.documentId).toBe(documentId);
    expect(calls).toHaveLength(1);
    const retainedContent = JSON.parse(calls[0]?.[1] as string) as {
      cwd: string;
      sessionFile: string;
      sessionId: string;
      branchLeafId: string;
      projection: string;
      importQualityProfile: string;
      chunkIndex: number;
      messageRange: { start: number; end: number };
      messages: Array<Record<string, unknown>>;
    };
    expect(retainedContent).toMatchObject({
      source: "pi-session-import",
      sessionFile,
      cwd: dir,
      sessionId: "session-provenance",
      branchLeafId: "a-original",
      projection: "curated-turns-v1",
      importQualityProfile: "strict",
      chunkIndex: 0,
      messageRange: { start: 0, end: 1 },
    });
    expect(retainedContent.messages).toEqual([
      expect.objectContaining({
        id: "u-original",
        parentId: null,
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      expect.objectContaining({
        id: "a-original",
        parentId: "u-original",
        role: "assistant",
        timestamp: "2026-01-01T00:01:00.000Z",
      }),
    ]);
    expect(retainedContent.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "spoof-user" }),
        expect.objectContaining({ parentId: "spoof-parent" }),
      ]),
    );
    const retainedOptions = calls[0]?.[2] as {
      documentId: string;
      updateMode: string;
      tags: string[];
      metadata: Record<string, string>;
    };
    expect(retainedOptions).toMatchObject({
      documentId,
      updateMode: "replace",
      tags: expect.arrayContaining([
        "source:pi",
        "import:historical",
        "imported:true",
        "session:session-provenance",
        "branch:a-original",
        `document:${documentId}`,
        expect.stringMatching(/^repo:/),
      ]),
      metadata: expect.objectContaining({
        source: "pi-hindsight",
        retainSource: "import",
        pi_session_file: sessionFile,
        imported: "true",
        cwd: dir,
        session_id: "session-provenance",
        branch_leaf_id: "a-original",
        import_mode: "curated",
        import_quality_profile: "strict",
        projection_version: "curated-turns-v1",
        import_profile: "turns-12-bytes-80000",
        chunk_index: "0",
        message_range_start: "0",
        message_range_end: "1",
        include_branches: "current-only",
        tool_results: "summary",
        content_hash: result.documents[0]?.contentHash,
      }),
    });

    const manifest = await readImportManifest(result.manifestPath);
    const checkpoint = await readImportCheckpoint(result.checkpointPath);
    expect(manifest.imports[documentId]).toMatchObject({
      documentId,
      bankId: "bank",
      sourceFile: sessionFile,
      contentHash: result.documents[0]?.contentHash,
      messageCount: 2,
      leafId: "a-original",
      sessionId: "session-provenance",
      cwd: dir,
      includeBranches: "current-only",
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
      projectionVersion: "curated-turns-v1",
      importProfile: "turns-12-bytes-80000",
      chunkIndex: 0,
      messageRange: { start: 0, end: 1 },
      updateMode: "replace",
    });
    expect(checkpoint).toMatchObject({
      runId: result.runId,
      sourceFile: sessionFile,
      bankId: "bank",
      sessionId: "session-provenance",
      cwd: dir,
      includeBranches: "current-only",
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
      updateMode: "replace",
    });
    expect(checkpoint?.documents[documentId]).toMatchObject({
      documentId,
      leafId: "a-original",
      contentHash: result.documents[0]?.contentHash,
      messageCount: 2,
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
      projectionVersion: "curated-turns-v1",
      importProfile: "turns-12-bytes-80000",
      chunkIndex: 0,
      messageRange: { start: 0, end: 1 },
      status: "completed",
    });
  });

  it("supports raw and forensic import modes as explicit escape hatches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-mode-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-mode", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "u1",
          parentId: null,
          message: { role: "user", content: "hi" },
        }),
        JSON.stringify({
          type: "message",
          id: "recall-memory",
          parentId: "u1",
          message: { role: "assistant", content: "<hindsight-memory>recall</hindsight-memory>" },
        }),
        JSON.stringify({
          type: "message",
          id: "tool1",
          parentId: "recall-memory",
          message: { role: "toolResult", name: "read", content: "successful output" },
        }),
      ].join("\n"),
    );

    const raw = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: {
          ...DEFAULT_CONFIG.import,
          mode: "raw",
          qualityProfile: "strict",
          toolResults: "summary",
        },
      },
      dryRun: true,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });
    const forensic = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: {
          ...DEFAULT_CONFIG.import,
          mode: "forensic",
          qualityProfile: "strict",
          toolResults: "summary",
        },
      },
      dryRun: true,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    expect(raw.documents[0]).toMatchObject({
      rawMessageCount: 2,
      projectedMessageCount: 2,
      droppedToolResultCount: 0,
    });
    expect(raw.documents[0]).not.toHaveProperty("importProfile");
    expect(raw.documents[0]).not.toHaveProperty("importQualityProfile");
    expect(forensic.documents[0]).toMatchObject({
      rawMessageCount: 3,
      projectedMessageCount: 3,
      droppedToolResultCount: 0,
    });
    expect(forensic.documents[0]).not.toHaveProperty("importProfile");
    expect(forensic.documents[0]).not.toHaveProperty("importQualityProfile");
    expect(raw.documentId).toBe(forensic.documentId);
  });

  it("retains current branch import with repo tags, provenance, deterministic branch document id, and replace mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    const parentSessionFile = join(dir, "parent-session.jsonl");
    const parentSessionId = stableSessionId(parentSessionFile, dir);
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          id: "session-1",
          cwd: dir,
          timestamp: "s-t",
          parentSession: parentSessionFile,
        }),
        "{bad json}",
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          timestamp: "t1",
          message: { role: "user", content: "hi" },
        }),
        JSON.stringify({
          type: "message",
          id: "recall-memory",
          parentId: "root",
          timestamp: "t-recall",
          message: {
            role: "assistant",
            content: "<hindsight-memory>persisted recall</hindsight-memory>",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "legacy-recall-memory",
          parentId: "recall-memory",
          timestamp: "t-legacy-recall",
          message: {
            role: "assistant",
            content: "<hindsight_memories>legacy recall</hindsight_memories>",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "custom-recall-memory",
          parentId: "legacy-recall-memory",
          timestamp: "t-custom-recall",
          message: { role: "assistant", customType: "hindsight-recall", content: "custom recall" },
        }),
        JSON.stringify({
          type: "message",
          id: "old",
          parentId: "root",
          timestamp: "t2",
          message: { role: "assistant", content: "old branch" },
        }),
        JSON.stringify({
          type: "message",
          id: "current",
          parentId: "custom-recall-memory",
          timestamp: "t3",
          message: { role: "assistant", content: "TOKEN=secret" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });
    expect(result.messageCount).toBe(2);
    expect(result.malformedLineCount).toBe(1);
    expect(result.documentId).toBe(
      "pi-import:session-1:leaf:current:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
    );
    expect(result.documents).toEqual([
      expect.objectContaining({
        documentId:
          "pi-import:session-1:leaf:current:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
        leafId: "current",
        messageCount: 2,
        contentHash: expect.any(String),
        contentBytes: expect.any(Number),
        tags: expect.arrayContaining(["import:historical"]),
        updateMode: "replace",
        bankId: "bank",
        wouldWrite: true,
      }),
    ]);
    const manifest = await readImportManifest(result.manifestPath);
    expect(manifest.imports[result.documentId]).toMatchObject({
      documentId: result.documentId,
      bankId: "bank",
      sourceFile: sessionFile,
      messageCount: 2,
      leafId: "current",
      sessionId: "session-1",
      cwd: dir,
      includeBranches: "current-only",
      updateMode: "replace",
      contentHash: result.documents[0]?.contentHash,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("bank");
    expect(calls[0]?.[1]).not.toContain("TOKEN=secret");
    expect(calls[0]?.[1]).not.toContain("old branch");
    expect(calls[0]?.[1]).not.toContain("<hindsight-memory>");
    expect(calls[0]?.[1]).not.toContain("<hindsight_memories>");
    expect(calls[0]?.[1]).not.toContain("custom recall");
    expect(calls[0]?.[1]).toContain(parentSessionId);
    const retainedContent = calls[0]?.[1] as string;
    expect(JSON.parse(retainedContent).parentSessionFile).toBe(parentSessionFile);
    expect(calls[0]?.[2]).toMatchObject({
      updateMode: "replace",
      documentId: result.documentId,
      async: true,
      observationScopes: [[expect.stringMatching(/^harness:/)], [expect.stringMatching(/^repo:/)]],
      tags: expect.arrayContaining([
        "source:pi",
        "import:historical",
        "imported:true",
        "session:session-1",
        "branch:current",
        `parent:${parentSessionId}`,
        expect.stringMatching(/^repo:/),
        "forked:true",
      ]),
      metadata: expect.objectContaining({
        pi_session_file: sessionFile,
        cwd: dir,
        session_id: "session-1",
        parent_session_id: parentSessionId,
        parent_session_file: parentSessionFile,
        branch_leaf_id: "current",
        session_timestamp: "s-t",
      }),
    });
  });

  it("flushes existing retain backlog before completing import delivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-backlog", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "import after backlog" },
        }),
      ].join("\n"),
    );
    const config = DEFAULT_CONFIG;
    const queuePath = resolveQueuePath(dir, config.retain.queuePath);
    await enqueueRetainJob(queuePath, {
      id: "existing",
      bankId: "bank",
      createdAt: "now",
      documentId: "existing-doc",
      updateMode: "replace",
      item: { content: "existing", context: "existing" },
      retries: 0,
    });
    const calls: unknown[][] = [];

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls.map((call) => (call[2] as { documentId: string }).documentId)).toEqual([
      "existing-doc",
      "pi-import:session-backlog:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0",
    ]);
    expect(await readRetainQueue(queuePath)).toEqual([]);
    expect(result.documents[0]?.status).toBe("completed");
  });

  it("marks interrupted import delivery as queued when retain queue keeps the job", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-queued", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "queued import" },
        }),
      ].join("\n"),
    );
    const config = {
      ...DEFAULT_CONFIG,
      import: {
        ...DEFAULT_CONFIG.import,
        qualityProfile: "strict" as const,
        toolResults: "content" as const,
      },
    };

    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config,
        client: {
          retain: async () => {
            throw new Error("offline");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);

    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    const documentId =
      "pi-import:session-queued:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    expect(checkpoint).toMatchObject({
      toolResults: "content",
      importQualityProfile: "strict",
    });
    expect(checkpoint?.documents[documentId]).toMatchObject({
      status: "queued",
      toolResults: "content",
      importQualityProfile: "strict",
      error: expect.stringContaining("queued"),
    });
    const queue = await readRetainQueue(resolveQueuePath(dir, config.retain.queuePath));
    expect(queue.map((job) => job.documentId)).toEqual([documentId]);
  });

  it("records strict curated quality context on failed checkpoint documents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(dir, ".pi/hindsight/queue-blocker"), "not a directory");
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-failed", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "failed import" },
        }),
      ].join("\n"),
    );
    const config = {
      ...DEFAULT_CONFIG,
      retain: {
        ...DEFAULT_CONFIG.retain,
        queuePath: ".pi/hindsight/queue-blocker/retain-queue.jsonl",
      },
      import: {
        ...DEFAULT_CONFIG.import,
        qualityProfile: "strict" as const,
        toolResults: "summary" as const,
      },
    };

    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow();

    const documentId =
      "pi-import:session-failed:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(checkpoint).toMatchObject({
      toolResults: "summary",
      importQualityProfile: "strict",
    });
    expect(checkpoint?.documents[documentId]).toMatchObject({
      status: "failed",
      toolResults: "summary",
      importQualityProfile: "strict",
      error: expect.any(String),
    });
  });

  it("imports all leaves only when includeBranches is all-leaves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-2", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "root",
          message: { role: "assistant", content: "a" },
        }),
        JSON.stringify({
          type: "message",
          id: "b",
          parentId: "root",
          message: { role: "assistant", content: "b" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: { ...DEFAULT_CONFIG.import, includeBranches: "all-leaves" },
      },
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });
    expect(result.documents).toEqual([
      expect.objectContaining({
        documentId: "pi-import:session-2:leaf:a:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
        leafId: "a",
        messageCount: 2,
        contentHash: expect.any(String),
      }),
      expect.objectContaining({
        documentId: "pi-import:session-2:leaf:b:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
        leafId: "b",
        messageCount: 2,
        contentHash: expect.any(String),
      }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => (call[2] as { documentId: string }).documentId)).toEqual([
      "pi-import:session-2:leaf:a:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
      "pi-import:session-2:leaf:b:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
    ]);
  });

  it("includes repo/session/branch tags required for project recall for all-leaves import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-tags", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf-a",
          parentId: "root",
          message: { role: "assistant", content: "leaf a" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf-b",
          parentId: "root",
          message: { role: "assistant", content: "leaf b" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    await importPiSession({
      sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: { ...DEFAULT_CONFIG.import, includeBranches: "all-leaves" },
      },
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });
    expect(calls).toHaveLength(2);
    const leafAOptions = calls[0]?.[2] as { tags: string[] };
    const leafBOptions = calls[1]?.[2] as { tags: string[] };
    // Each leaf must carry all tags required for default project recall.
    for (const [leafId, options] of [
      ["leaf-a", leafAOptions],
      ["leaf-b", leafBOptions],
    ] as [string, { tags: string[] }][]) {
      expect(options.tags).toEqual(
        expect.arrayContaining([
          "source:pi",
          "import:historical",
          "imported:true",
          "session:session-tags",
          `branch:${leafId}`,
          "forked:true",
          expect.stringMatching(/^repo:/),
          expect.stringMatching(/^document:/),
        ]),
      );
    }
    // Each leaf carries its own branch tag, not the other leaf's.
    expect(leafAOptions.tags).toContain("branch:leaf-a");
    expect(leafAOptions.tags).not.toContain("branch:leaf-b");
    expect(leafBOptions.tags).toContain("branch:leaf-b");
    expect(leafBOptions.tags).not.toContain("branch:leaf-a");
    // Both leaves share the same repo and session tags.
    const repoTag = leafAOptions.tags.find((t) => t.startsWith("repo:"));
    expect(repoTag).toBeDefined();
    expect(leafBOptions.tags).toContain(repoTag);
    expect(leafAOptions.tags).toContain("session:session-tags");
    expect(leafBOptions.tags).toContain("session:session-tags");
  });

  it("includes repo/session/branch tags required for project recall for current-branch import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-current-tags", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf",
          parentId: "root",
          message: { role: "assistant", content: "leaf" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });
    expect(calls).toHaveLength(1);
    const options = calls[0]?.[2] as { tags: string[] };
    expect(options.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        "import:historical",
        "imported:true",
        "session:session-current-tags",
        "branch:leaf",
        expect.stringMatching(/^repo:/),
        expect.stringMatching(/^document:/),
      ]),
    );
    // No global memory pollution: the single retain call targets the specified bank only.
    expect(calls[0]?.[0]).toBe("bank");
    expect(calls).toHaveLength(1);
  });

  it("previews import without retaining or writing manifests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-preview", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "root",
          message: { role: "assistant", content: "a" },
        }),
        JSON.stringify({
          type: "message",
          id: "b",
          parentId: "root",
          message: { role: "assistant", content: "b" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      includeBranches: "all-leaves",
      dryRun: true,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.retained).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.messageCount).toBe(4);
    expect(result.checkpointPath).toBe(join(dir, ".pi/hindsight/import-checkpoint.json"));
    await expect(readImportCheckpoint(result.checkpointPath)).resolves.toBeUndefined();
    expect(result.documents).toEqual([
      expect.objectContaining({
        documentId:
          "pi-import:session-preview:leaf:a:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
        leafId: "a",
        messageCount: 2,
        contentBytes: expect.any(Number),
        tags: expect.arrayContaining([
          "source:pi",
          "import:historical",
          "imported:true",
          "session:session-preview",
          "branch:a",
          "forked:true",
          expect.stringMatching(/^repo:/),
        ]),
        updateMode: "replace",
        bankId: "bank",
        wouldWrite: false,
      }),
      expect.objectContaining({
        documentId:
          "pi-import:session-preview:leaf:b:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
        leafId: "b",
        messageCount: 2,
        wouldWrite: false,
      }),
    ]);
    expect(calls).toHaveLength(0);
    await expect(readImportManifest(result.manifestPath)).resolves.toEqual({
      version: 1,
      imports: {},
    });
  });

  it("historical import ignores pending next opt-out session state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    await setNextSessionRetainMode(dir, sessionFile, "off");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-next-opt-out", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "1",
          parentId: null,
          message: { role: "user", content: "import me anyway" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importPiSession({
      sessionFile,
      cwd: dir,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toContain("import me anyway");
    expect(result.documents[0]?.status).toBe("completed");
  });

  it("resumes completed checkpoint documents without duplicate retain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-resume", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "root",
          message: { role: "assistant", content: "a" },
        }),
        JSON.stringify({
          type: "message",
          id: "b",
          parentId: "root",
          message: { role: "assistant", content: "b" },
        }),
      ].join("\n"),
    );
    const firstCalls: unknown[][] = [];
    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        includeBranches: "all-leaves",
        client: {
          retain: async (...args: unknown[]) => {
            firstCalls.push(args);
            if (firstCalls.length === 2) throw new Error("interrupted");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);

    const documentA =
      "pi-import:session-resume:leaf:a:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1";
    const documentB =
      "pi-import:session-resume:leaf:b:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1";
    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(checkpoint?.documents[documentA]?.status).toBe("completed");
    expect(checkpoint?.documents[documentB]?.status).toBe("queued");
    const interruptedManifest = await readImportManifest(
      join(dir, ".pi/hindsight/import-manifest.json"),
    );
    expect(interruptedManifest.imports[documentA]).toMatchObject({
      documentId: documentA,
      leafId: "a",
      contentHash: checkpoint?.documents[documentA]?.contentHash,
    });
    const documentAImportedAt = interruptedManifest.imports[documentA]?.importedAt;
    expect(documentAImportedAt).toEqual(expect.any(String));

    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);
    const documentACheckpoint = checkpoint?.documents[documentA];
    expect(documentACheckpoint).toMatchObject({ contentHash: expect.any(String) });
    await enqueueRetainJob(
      queuePath,
      queuedImportRetainJob({
        id: "stale-completed-doc",
        documentId: documentA,
        sourceFile: sessionFile,
        cwd: dir,
        sessionId: "session-resume",
        leafId: "a",
        contentHash: documentACheckpoint?.contentHash ?? "",
        includeBranches: "all-leaves",
        projectionVersion: documentACheckpoint?.projectionVersion,
        importProfile: documentACheckpoint?.importProfile,
        chunkIndex: documentACheckpoint?.chunkIndex,
        messageRange: documentACheckpoint?.messageRange,
      }),
    );

    const secondCalls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      includeBranches: "all-leaves",
      client: {
        retain: async (...args: unknown[]) => {
          secondCalls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(secondCalls).toHaveLength(1);
    const retainedOptions = secondCalls[0]?.[2] as { documentId: string };
    expect(retainedOptions.documentId).toBe(documentB);
    expect(result.documents.map((document) => [document.leafId, document.status])).toEqual([
      ["a", "skipped"],
      ["b", "completed"],
    ]);
    const resumedCheckpoint = await readImportCheckpoint(result.checkpointPath);
    expect(resumedCheckpoint?.documents[documentA]?.status).toBe("completed");
    expect(resumedCheckpoint?.documents[documentB]?.status).toBe("completed");
    const manifest = await readImportManifest(result.manifestPath);
    expect(Object.keys(manifest.imports).sort()).toEqual([documentA, documentB]);
    expect(manifest.imports[documentA]?.importedAt).toBe(documentAImportedAt);
    await expect(readRetainQueue(queuePath)).resolves.toEqual([]);
  }, 15_000);

  it("keeps non-import queued retains that share a completed import document id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-skip-cleanup-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-skip-cleanup", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
      ].join("\n"),
    );
    const documentId =
      "pi-import:session-skip-cleanup:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";

    const first = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });
    expect(first.documents[0]?.status).toBe("completed");
    const checkpoint = await readImportCheckpoint(first.checkpointPath);
    const checkpointDocument = checkpoint?.documents[documentId];
    expect(checkpointDocument).toMatchObject({ contentHash: expect.any(String) });

    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);
    await enqueueRetainJob(
      queuePath,
      queuedImportRetainJob({
        id: "duplicate-completed-import",
        documentId,
        sourceFile: sessionFile,
        cwd: dir,
        sessionId: "session-skip-cleanup",
        leafId: "root",
        contentHash: checkpointDocument?.contentHash ?? "",
        projectionVersion: checkpointDocument?.projectionVersion,
        importProfile: checkpointDocument?.importProfile,
        chunkIndex: checkpointDocument?.chunkIndex,
        messageRange: checkpointDocument?.messageRange,
      }),
    );
    await enqueueRetainJob(queuePath, {
      id: "explicit-same-document-id",
      bankId: "bank",
      createdAt: "now",
      documentId,
      updateMode: "replace",
      item: {
        content: "explicit content must stay queued",
        context: "explicit context must stay queued",
        metadata: { source: "pi-hindsight", retainSource: "tool" },
      },
      retries: 0,
    });

    const second = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    expect(second.documents[0]?.status).toBe("skipped");
    expect((await readRetainQueue(queuePath)).map((job) => job.id)).toEqual([
      "explicit-same-document-id",
    ]);
  });

  it("starts a fresh checkpoint run when update mode changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-mode", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf",
          parentId: "root",
          message: { role: "assistant", content: "leaf" },
        }),
      ].join("\n"),
    );

    await importPiSession({
      sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: { ...DEFAULT_CONFIG.import, replaceExistingImportedDocs: false },
      },
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    const calls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ status: "completed", updateMode: "replace" });
    expect(result.runId).toContain(":replace:");
  });

  it("drops queued import jobs when update mode changes before retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-queued-mode-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-queued-mode", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "mode mismatch" },
        }),
      ].join("\n"),
    );
    const documentId =
      "pi-import:session-queued-mode:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);

    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config: {
          ...DEFAULT_CONFIG,
          import: { ...DEFAULT_CONFIG.import, replaceExistingImportedDocs: false },
        },
        client: {
          retain: async () => {
            throw new Error("offline");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);
    expect(
      (await readRetainQueue(queuePath)).map((job) => [job.documentId, job.updateMode]),
    ).toEqual([[documentId, "append"]]);

    const calls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls).toHaveLength(1);
    const retainedOptions = calls[0]?.[2] as { updateMode: string };
    expect(retainedOptions.updateMode).toBe("replace");
    expect(result.documents[0]).toMatchObject({
      documentId,
      updateMode: "replace",
      status: "completed",
    });
    await expect(readRetainQueue(queuePath)).resolves.toEqual([]);
  });

  it("drops queued import jobs when content hash changes before retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-queued-content-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    const writeSession = (content: string) =>
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({ type: "session", id: "session-queued-content", cwd: dir }),
          JSON.stringify({
            type: "message",
            id: "root",
            parentId: null,
            message: { role: "user", content },
          }),
        ].join("\n"),
      );
    writeSession("old queued content");
    const documentId =
      "pi-import:session-queued-content:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);

    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => {
            throw new Error("offline");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);
    const oldQueue = await readRetainQueue(queuePath);
    expect(oldQueue[0]?.item.content).toContain("old queued content");

    writeSession("new retained content");
    const calls: unknown[][] = [];
    const result = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls).toHaveLength(1);
    const retainedContent = calls[0]?.[1] as string;
    const retainedOptions = calls[0]?.[2] as { metadata: Record<string, string> };
    expect(retainedContent).toContain("new retained content");
    expect(retainedContent).not.toContain("old queued content");
    expect(retainedOptions.metadata.content_hash).toBe(result.documents[0]?.contentHash);
    expect(result.documents[0]).toMatchObject({ documentId, status: "completed" });
    const manifest = await readImportManifest(result.manifestPath);
    expect(manifest.imports[documentId]?.contentHash).toBe(result.documents[0]?.contentHash);
    await expect(readRetainQueue(queuePath)).resolves.toEqual([]);
  });

  it("fails closed when stale queued import cleanup cannot quarantine malformed queue lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-stale-cleanup-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-stale-cleanup", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "NEW_CONTENT" },
        }),
      ].join("\n"),
    );
    const documentId =
      "pi-import:session-stale-cleanup:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);
    mkdirSync(join(dir, ".pi", "hindsight"), { recursive: true });
    mkdirSync(`${queuePath}.malformed.jsonl`, { recursive: true });
    writeFileSync(
      queuePath,
      `${JSON.stringify(
        queuedImportRetainJob({
          id: "stale-old-import",
          documentId,
          content: "OLD_CONTENT",
          context: "OLD_CONTEXT",
          sourceFile: sessionFile,
          cwd: dir,
          sessionId: "session-stale-cleanup",
          leafId: "root",
          contentHash: "old-content-hash",
          projectionVersion: "curated-turns-v1",
          importProfile: "turns-12-bytes-80000",
          chunkIndex: 0,
          messageRange: { start: 0, end: 0 },
        }),
      )}\n{not json\n`,
    );
    const calls: string[] = [];

    await expect(
      importPiSession({
        sessionFile,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async (_bankId, content) => {
            calls.push(content);
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
    expect(readFileSync(queuePath, "utf8")).toContain("OLD_CONTENT");
  });

  it("starts a fresh checkpoint run when import mode changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-mode-change-"));
    mkdirSync(join(dir, ".git"));
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-import-mode-change", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf",
          parentId: "root",
          message: { role: "assistant", content: "leaf" },
        }),
      ].join("\n"),
    );

    await importPiSession({
      sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    const calls: unknown[][] = [];
    const raw = await importPiSession({
      sessionFile,
      bankId: "bank",
      config: { ...DEFAULT_CONFIG, import: { ...DEFAULT_CONFIG.import, mode: "raw" } },
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(calls).toHaveLength(1);
    expect(raw.documents[0]).toMatchObject({
      documentId: "pi-import:session-import-mode-change:leaf:leaf",
      importMode: "raw",
      status: "completed",
    });
    expect(raw.runId).toContain(":raw:replace:");
    const checkpoint = await readImportCheckpoint(raw.checkpointPath);
    expect(checkpoint).toMatchObject({ runId: raw.runId, importMode: "raw" });
    expect(Object.keys(checkpoint?.documents ?? {})).toEqual([
      "pi-import:session-import-mode-change:leaf:leaf",
    ]);
  });

  it.each(equivalentPathVariants)(
    "accepts equivalent normalized project cwd paths: $name",
    async ({ sessionCwd }) => {
      const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
      mkdirSync(join(dir, ".git"));
      const sessionFile = join(dir, "session.jsonl");
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({ type: "session", id: "session-normalized", cwd: sessionCwd(dir) }),
          JSON.stringify({
            type: "message",
            id: "root",
            parentId: null,
            message: { role: "user", content: "normalized cwd" },
          }),
        ].join("\n"),
      );

      const result = await importPiSession({
        sessionFile,
        cwd: dir,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      });

      expect(result.documents[0]?.documentId).toBe(
        "pi-import:session-normalized:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0",
      );
    },
  );

  it("rejects explicit imports from a different project cwd", async () => {
    const current = mkdtempSync(join(tmpdir(), "pi-hindsight-import-current-"));
    const other = mkdtempSync(join(tmpdir(), "pi-hindsight-import-other-"));
    const sessionFile = join(other, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "cross-project", cwd: other }),
        JSON.stringify({
          type: "message",
          id: "1",
          parentId: null,
          message: { role: "user", content: "other project" },
        }),
      ].join("\n"),
    );

    await expect(
      importPiSession({
        sessionFile,
        cwd: current,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow("Refusing to import session from cwd");
  });

  it("recreates corrupt manifest and checkpoint files during import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-import-"));
    mkdirSync(join(dir, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      join(dir, ".pi/hindsight/import-manifest.json"),
      JSON.stringify({ imports: "bad" }),
    );
    writeFileSync(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
      JSON.stringify({ runId: "will-not-matter", documents: "bad" }),
    );
    const sessionFile = join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "corrupt-sidecars", cwd: dir }),
        JSON.stringify({
          type: "message",
          id: "1",
          parentId: null,
          message: { role: "user", content: "recover import sidecars" },
        }),
      ].join("\n"),
    );

    const result = await importPiSession({
      sessionFile,
      cwd: dir,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    await expect(readImportManifest(result.manifestPath)).resolves.toMatchObject({ version: 1 });
    await expect(readImportCheckpoint(result.checkpointPath)).resolves.toMatchObject({
      version: 1,
    });
    expect(result.documents[0]?.status).toBe("completed");
  });

  it("discovers only sessions scoped to the current project cwd", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const other = mkdtempSync(join(tmpdir(), "pi-hindsight-other-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
    const current = join(sessionsDir, "current.jsonl");
    const related = join(sessionsDir, "related.jsonl");
    const unrelated = join(sessionsDir, "unrelated.jsonl");
    writeFileSync(
      current,
      [
        JSON.stringify({ type: "session", id: "current", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "c" } }),
      ].join("\n"),
    );
    writeFileSync(
      related,
      [
        JSON.stringify({ type: "session", id: "related", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "r" } }),
      ].join("\n"),
    );
    writeFileSync(
      unrelated,
      [
        JSON.stringify({ type: "session", id: "other", cwd: other }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "o" } }),
      ].join("\n"),
    );
    writeFileSync(join(sessionsDir, "note.txt"), "ignore");
    // Directory with a .jsonl name must be skipped by isFile (not counted as scanned).
    mkdirSync(join(sessionsDir, "not-a-file.jsonl"));

    const result = await discoverProjectSessionFiles({ cwd: project, currentSessionFile: current });

    expect(result.scanned).toBe(3);
    expect(result.sessionFiles).toEqual([current, related].sort());
  });

  it.each([
    {
      name: "different cwd",
      replacementSession: (other: string) =>
        JSON.stringify({ type: "session", id: "moved", cwd: other }),
      expectedError: /Refusing to import session from cwd/,
    },
    {
      name: "missing cwd",
      replacementSession: () => JSON.stringify({ type: "session", id: "moved" }),
      expectedError: /Refusing to import session without cwd/,
    },
  ])(
    "revalidates project cwd during project import execution after discovery: $name",
    async ({ replacementSession, expectedError }) => {
      const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
      const other = mkdtempSync(join(tmpdir(), "pi-hindsight-other-"));
      const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
      const sessionFile = join(sessionsDir, "current.jsonl");
      const projectSession = [
        JSON.stringify({ type: "session", id: "current", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "c" } }),
      ].join("\n");
      const movedSession = [
        replacementSession(other),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "m" } }),
      ].join("\n");
      writeFileSync(sessionFile, projectSession);

      const fsPromises =
        await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      let sessionReads = 0;
      const calls: unknown[][] = [];

      vi.resetModules();
      vi.doMock("node:fs/promises", () => ({
        ...fsPromises,
        readFile: async (...args: Parameters<typeof fsPromises.readFile>) => {
          const result = await fsPromises.readFile(...args);
          if (args[0] === sessionFile && sessionReads++ === 0) {
            await fsPromises.writeFile(sessionFile, movedSession, "utf8");
          }
          return result;
        },
      }));

      try {
        const { importProjectSessions: importProjectSessionsWithSwappedRead } =
          await import("../extensions/imports/import-sessions.js");

        await expect(
          importProjectSessionsWithSwappedRead({
            cwd: project,
            currentSessionFile: sessionFile,
            bankId: "bank",
            config: DEFAULT_CONFIG,
            client: {
              retain: async (...args: unknown[]) => {
                calls.push(args);
              },
              recall: async () => [],
              reflect: async () => ({}),
            },
          }),
        ).rejects.toThrow(expectedError);
      } finally {
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }

      expect(sessionReads).toBe(2);
      expect(calls).toHaveLength(0);
    },
  );

  it("discovers repeated equivalent normalized project cwd paths", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const other = mkdtempSync(join(tmpdir(), "pi-hindsight-other-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
    const expected: string[] = [];

    for (const [index, variant] of equivalentPathVariants.entries()) {
      const file = join(sessionsDir, `related-${index}.jsonl`);
      expected.push(file);
      writeFileSync(
        file,
        [
          JSON.stringify({
            type: "session",
            id: `related-${index}`,
            cwd: variant.sessionCwd(project),
          }),
          JSON.stringify({
            type: "message",
            id: "1",
            message: { role: "user", content: `related ${index}` },
          }),
        ].join("\n"),
      );
    }
    writeFileSync(
      join(sessionsDir, "unrelated.jsonl"),
      [
        JSON.stringify({ type: "session", id: "other", cwd: join(other, "nested", "..") }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "o" } }),
      ].join("\n"),
    );

    const result = await discoverProjectSessionFiles({
      cwd: join(project, "."),
      searchDir: sessionsDir,
    });

    expect(result.scanned).toBe(equivalentPathVariants.length + 1);
    expect(result.sessionFiles).toEqual(expected.sort());
  });

  it("resumes project session imports with per-file checkpoints", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
    const first = join(sessionsDir, "first.jsonl");
    const second = join(sessionsDir, "second.jsonl");
    writeFileSync(
      first,
      [
        JSON.stringify({ type: "session", id: "first", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "first" } }),
      ].join("\n"),
    );
    writeFileSync(
      second,
      [
        JSON.stringify({ type: "session", id: "second", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "second" } }),
      ].join("\n"),
    );
    const firstCalls: unknown[][] = [];
    await expect(
      importProjectSessions({
        cwd: project,
        currentSessionFile: first,
        bankId: "bank",
        config: {
          ...DEFAULT_CONFIG,
          import: { ...DEFAULT_CONFIG.import, replaceExistingImportedDocs: false },
        },
        client: {
          retain: async (...args: unknown[]) => {
            firstCalls.push(args);
            if (firstCalls.length === 2) throw new Error("interrupted");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);

    const secondCalls: unknown[][] = [];
    const result = await importProjectSessions({
      cwd: project,
      currentSessionFile: first,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: { ...DEFAULT_CONFIG.import, replaceExistingImportedDocs: false },
      },
      client: {
        retain: async (...args: unknown[]) => {
          secondCalls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(secondCalls).toHaveLength(1);
    const retainedOptions = secondCalls[0]?.[2] as { documentId: string };
    expect(retainedOptions.documentId).toBe(
      "pi-import:second:leaf:1:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0",
    );
    expect(result.imported.map((item) => [item.sessionFile, item.documents[0]?.status])).toEqual([
      [first, "skipped"],
      [second, "completed"],
    ]);
    expect(result.imported[0]?.checkpointPath).not.toBe(result.imported[1]?.checkpointPath);
  });

  it("keeps all-leaves project import provenance aligned across retained docs, manifest, and checkpoint", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-provenance-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-provenance-"));
    const sessionFile = join(sessionsDir, "project.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "project-all-leaves", cwd: project }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf-a",
          parentId: "root",
          message: { role: "assistant", content: "leaf a" },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf-b",
          parentId: "root",
          message: { role: "assistant", content: "leaf b" },
        }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];
    const config = {
      ...DEFAULT_CONFIG,
      import: {
        ...DEFAULT_CONFIG.import,
        includeBranches: "all-leaves" as const,
        qualityProfile: "strict" as const,
        toolResults: "summary" as const,
      },
    };

    const result = await importProjectSessions({
      cwd: project,
      currentSessionFile: sessionFile,
      bankId: "bank",
      config,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.imported).toHaveLength(1);
    expect(calls).toHaveLength(2);
    const imported = result.imported[0];
    expect(imported?.documents.map((document) => document.leafId)).toEqual(["leaf-a", "leaf-b"]);
    const manifest = await readImportManifest(imported?.manifestPath ?? "");
    const checkpoint = await readImportCheckpoint(imported?.checkpointPath ?? "");
    expect(checkpoint).toMatchObject({
      sourceFile: sessionFile,
      bankId: "bank",
      sessionId: "project-all-leaves",
      cwd: project,
      includeBranches: "all-leaves",
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
    });

    for (const [index, leafId] of ["leaf-a", "leaf-b"].entries()) {
      const documentId = `pi-import:project-all-leaves:leaf:${leafId}:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1`;
      const document = imported?.documents[index];
      const retainedContent = JSON.parse(calls[index]?.[1] as string) as {
        cwd: string;
        sessionFile: string;
        sessionId: string;
        branchLeafId: string;
        messageRange: { start: number; end: number };
        messages: Array<Record<string, unknown>>;
      };
      const retainedOptions = calls[index]?.[2] as {
        documentId: string;
        tags: string[];
        metadata: Record<string, string>;
      };

      expect(retainedContent).toMatchObject({
        sessionFile,
        cwd: project,
        sessionId: "project-all-leaves",
        branchLeafId: leafId,
        messageRange: { start: 0, end: 1 },
      });
      expect(retainedContent.messages).toEqual([
        expect.objectContaining({ id: "root", parentId: null }),
        expect.objectContaining({ id: leafId, parentId: "root" }),
      ]);
      expect(retainedOptions).toMatchObject({
        documentId,
        tags: expect.arrayContaining([
          "source:pi",
          "import:historical",
          "imported:true",
          "session:project-all-leaves",
          `branch:${leafId}`,
          "forked:true",
          expect.stringMatching(/^repo:/),
        ]),
        metadata: expect.objectContaining({
          pi_session_file: sessionFile,
          cwd: project,
          session_id: "project-all-leaves",
          branch_leaf_id: leafId,
          include_branches: "all-leaves",
          import_mode: "curated",
          import_quality_profile: "strict",
          tool_results: "summary",
          message_range_start: "0",
          message_range_end: "1",
          content_hash: document?.contentHash,
        }),
      });
      expect(manifest.imports[documentId]).toMatchObject({
        documentId,
        bankId: "bank",
        sourceFile: sessionFile,
        contentHash: document?.contentHash,
        messageCount: 2,
        leafId,
        sessionId: "project-all-leaves",
        cwd: project,
        includeBranches: "all-leaves",
        importMode: "curated",
        toolResults: "summary",
        importQualityProfile: "strict",
        messageRange: { start: 0, end: 1 },
      });
      expect(checkpoint?.documents[documentId]).toMatchObject({
        documentId,
        contentHash: document?.contentHash,
        messageCount: 2,
        leafId,
        importMode: "curated",
        toolResults: "summary",
        importQualityProfile: "strict",
        messageRange: { start: 0, end: 1 },
        status: "completed",
      });
    }
  });

  it("retries repeated project imports across completed, queued, failed, and skipped docs without duplicate completed retain", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-retry-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-retry-"));
    const completeFile = join(sessionsDir, "01-complete.jsonl");
    const queuedFile = join(sessionsDir, "02-queued.jsonl");
    const failedFile = join(sessionsDir, "03-failed.jsonl");
    const files = [
      [completeFile, "project-complete", "complete"],
      [queuedFile, "project-queued", "queued"],
      [failedFile, "project-failed", "failed"],
    ] as const;
    for (const [file, sessionId, content] of files) {
      writeFileSync(
        file,
        [
          JSON.stringify({ type: "session", id: sessionId, cwd: project }),
          JSON.stringify({
            type: "message",
            id: "root",
            parentId: null,
            message: { role: "user", content },
          }),
        ].join("\n"),
      );
    }
    const completeDocument =
      "pi-import:project-complete:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const queuedDocument =
      "pi-import:project-queued:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";
    const failedDocument =
      "pi-import:project-failed:leaf:root:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0";

    const firstCalls: unknown[][] = [];
    await expect(
      importProjectSessions({
        cwd: project,
        currentSessionFile: completeFile,
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async (...args: unknown[]) => {
            firstCalls.push(args);
            if (firstCalls.length === 2) throw new Error("offline queued");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);
    expect(firstCalls.map((call) => (call[2] as { documentId: string }).documentId)).toEqual([
      completeDocument,
      queuedDocument,
    ]);

    const completeCheckpointPath = join(
      project,
      projectSessionCheckpointPath(DEFAULT_CONFIG.import.checkpointPath, completeFile),
    );
    const queuedCheckpointPath = join(
      project,
      projectSessionCheckpointPath(DEFAULT_CONFIG.import.checkpointPath, queuedFile),
    );
    const failedCheckpointPath = join(
      project,
      projectSessionCheckpointPath(DEFAULT_CONFIG.import.checkpointPath, failedFile),
    );
    const completeCheckpoint = await readImportCheckpoint(completeCheckpointPath);
    expect(completeCheckpoint?.documents[completeDocument]?.status).toBe("completed");
    expect(
      (await readImportCheckpoint(queuedCheckpointPath))?.documents[queuedDocument]?.status,
    ).toBe("queued");

    mkdirSync(join(project, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(project, ".pi/hindsight/queue-blocker"), "block queue dir");
    await expect(
      importPiSession({
        sessionFile: failedFile,
        cwd: project,
        bankId: "bank",
        config: {
          ...DEFAULT_CONFIG,
          retain: {
            ...DEFAULT_CONFIG.retain,
            queuePath: ".pi/hindsight/queue-blocker/retain-queue.jsonl",
          },
          import: {
            ...DEFAULT_CONFIG.import,
            checkpointPath: projectSessionCheckpointPath(
              DEFAULT_CONFIG.import.checkpointPath,
              failedFile,
            ),
          },
        },
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow();
    expect(
      (await readImportCheckpoint(failedCheckpointPath))?.documents[failedDocument]?.status,
    ).toBe("failed");

    const queuePath = resolveQueuePath(project, DEFAULT_CONFIG.retain.queuePath);
    const completeCheckpointDocument = completeCheckpoint?.documents[completeDocument];
    expect(completeCheckpointDocument).toMatchObject({ contentHash: expect.any(String) });
    await enqueueRetainJob(
      queuePath,
      queuedImportRetainJob({
        id: "stale-project-completed-doc",
        documentId: completeDocument,
        sourceFile: completeFile,
        cwd: project,
        sessionId: "project-complete",
        leafId: "root",
        contentHash: completeCheckpointDocument?.contentHash ?? "",
        projectionVersion: completeCheckpointDocument?.projectionVersion,
        importProfile: completeCheckpointDocument?.importProfile,
        chunkIndex: completeCheckpointDocument?.chunkIndex,
        messageRange: completeCheckpointDocument?.messageRange,
      }),
    );

    const secondCalls: unknown[][] = [];
    const result = await importProjectSessions({
      cwd: project,
      currentSessionFile: completeFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          secondCalls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.imported.map((item) => [item.sessionFile, item.documents[0]?.status])).toEqual([
      [completeFile, "skipped"],
      [queuedFile, "completed"],
      [failedFile, "completed"],
    ]);
    expect(secondCalls.map((call) => (call[2] as { documentId: string }).documentId)).toEqual([
      queuedDocument,
      failedDocument,
    ]);
    expect(
      (await readImportCheckpoint(completeCheckpointPath))?.documents[completeDocument]?.status,
    ).toBe("completed");
    expect(
      (await readImportCheckpoint(queuedCheckpointPath))?.documents[queuedDocument]?.status,
    ).toBe("completed");
    expect(
      (await readImportCheckpoint(failedCheckpointPath))?.documents[failedDocument]?.status,
    ).toBe("completed");
    const manifest = await readImportManifest(join(project, DEFAULT_CONFIG.import.manifestPath));
    expect(Object.keys(manifest.imports).sort()).toEqual([
      completeDocument,
      failedDocument,
      queuedDocument,
    ]);
    await expect(readRetainQueue(queuePath)).resolves.toEqual([]);
  }, 15_000);

  it("dry-runs project session import without writing unrelated sessions", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
    const current = join(sessionsDir, "current.jsonl");
    const unrelated = join(sessionsDir, "unrelated.jsonl");
    writeFileSync(
      current,
      [
        JSON.stringify({ type: "session", id: "current", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "c" } }),
      ].join("\n"),
    );
    writeFileSync(
      unrelated,
      [
        JSON.stringify({ type: "session", id: "other", cwd: "/other" }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "o" } }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importProjectSessions({
      cwd: project,
      currentSessionFile: current,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.sessionFiles).toEqual([current]);
    expect(result.documentCount).toBe(1);
    expect(result.messageCount).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("selects import branches without retaining or writing manifests", () => {
    const parsed = parseImportSessionJsonl(
      [
        JSON.stringify({ type: "session", id: "session-3", cwd: "/repo" }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          message: { role: "user", content: "root" },
        }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "root",
          message: { role: "assistant", content: "a" },
        }),
        JSON.stringify({
          type: "message",
          id: "b",
          parentId: "root",
          message: { role: "assistant", content: "b" },
        }),
      ].join("\n"),
    );

    expect(
      selectImportBranches(parsed, "current-only").map((branch) => ({
        leafId: branch.leafId,
        messages: branch.messages.map((message) => message.data.content),
      })),
    ).toEqual([{ leafId: "b", messages: ["root", "b"] }]);
    expect(
      selectImportBranches(parsed, "all-leaves").map((branch) => ({
        leafId: branch.leafId,
        messages: branch.messages.map((message) => message.data.content),
      })),
    ).toEqual([
      { leafId: "a", messages: ["root", "a"] },
      { leafId: "b", messages: ["root", "b"] },
    ]);
  });

  // Coverage for import paths previously exercised only via demoted slash commands.
  it("dry-runs a single Pi session import without retaining", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-import-session-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);
    const progress: string[] = [];

    const result = await importPiSession({
      sessionFile,
      cwd,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: { retain, recall: async () => [], reflect: async () => ({}) },
      onProgress: (event) => progress.push(event.message),
    });

    expect(retain).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.messageCount).toBe(1);
    expect(result.documents).toHaveLength(1);
    expect(progress.some((message) => /Reading session file|Planning import/.test(message))).toBe(
      true,
    );
  });

  it("imports project sessions with dry-run progress then writes after a real run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-import-project-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-project-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);
    const progress: string[] = [];

    const dryRun = await importProjectSessions({
      cwd,
      currentSessionFile: sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: { retain, recall: async () => [], reflect: async () => ({}) },
      onProgress: (event) => progress.push(event.message),
    });
    expect(dryRun.dryRun).toBe(true);
    expect(retain).not.toHaveBeenCalled();
    expect(
      progress.some((message) => /Scanning project session files|Previewing/.test(message)),
    ).toBe(true);

    const written = await importProjectSessions({
      cwd,
      currentSessionFile: sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: false,
      client: { retain, recall: async () => [], reflect: async () => ({}) },
    });
    expect(written.dryRun).toBe(false);
    expect(retain).toHaveBeenCalled();
    expect(written.documentCount).toBeGreaterThan(0);
  });

  it("skips broken .jsonl symlinks while discovering project sessions", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-sessions-"));
    const current = join(sessionsDir, "current.jsonl");
    writeFileSync(
      current,
      [
        JSON.stringify({ type: "session", id: "current", cwd: project }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "c" } }),
      ].join("\n"),
    );
    try {
      symlinkSync(join(sessionsDir, "missing-target.jsonl"), join(sessionsDir, "broken.jsonl"));
    } catch {
      // Symlink may be unavailable on some environments; skip the broken-link branch then.
      return;
    }

    const result = await discoverProjectSessionFiles({
      cwd: project,
      currentSessionFile: current,
    });
    expect(result.sessionFiles).toEqual([current]);
    expect(result.scanned).toBe(1);
  });
});
