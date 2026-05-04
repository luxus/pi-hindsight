import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  discoverProjectSessionFiles,
  importPiSession,
  importProjectSessions,
  parseImportSessionJsonl,
  parsePiSessionJsonl,
  selectImportBranches,
} from "../extensions/import-sessions.js";
import { readImportCheckpoint } from "../extensions/import-checkpoint.js";
import { readImportManifest } from "../extensions/import-manifest.js";
import { enqueueRetainJob, readRetainQueue, resolveQueuePath } from "../extensions/queue.js";
import { stableSessionId } from "../extensions/session.js";
import { setNextSessionRetainMode } from "../extensions/session-memory-meta.js";

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
          message: { role: "user", content: "remember architecture" },
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
          id: "a1",
          parentId: "tool2",
          message: { role: "assistant", content: "decision recorded" },
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
      rawMessageCount: 4,
      messageCount: 3,
      droppedToolResultCount: 1,
      topDroppedTools: [{ name: "read", count: 1, bytes: expect.any(Number) }],
      wouldWrite: false,
    });
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
    expect(result.documentId).toBe("pi-import:session-1:leaf:current");
    expect(result.documents).toEqual([
      expect.objectContaining({
        documentId: "pi-import:session-1:leaf:current",
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
      "pi-import:session-backlog:leaf:root",
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

    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(checkpoint?.documents["pi-import:session-queued:leaf:root"]?.status).toBe("queued");
    expect(checkpoint?.documents["pi-import:session-queued:leaf:root"]?.error).toContain("queued");
    const queue = await readRetainQueue(resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath));
    expect(queue.map((job) => job.documentId)).toEqual(["pi-import:session-queued:leaf:root"]);
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
        documentId: "pi-import:session-2:leaf:a",
        leafId: "a",
        messageCount: 2,
        contentHash: expect.any(String),
      }),
      expect.objectContaining({
        documentId: "pi-import:session-2:leaf:b",
        leafId: "b",
        messageCount: 2,
        contentHash: expect.any(String),
      }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => (call[2] as { documentId: string }).documentId)).toEqual([
      "pi-import:session-2:leaf:a",
      "pi-import:session-2:leaf:b",
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
        documentId: "pi-import:session-preview:leaf:a",
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
        documentId: "pi-import:session-preview:leaf:b",
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

    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(checkpoint?.documents["pi-import:session-resume:leaf:a"]?.status).toBe("completed");
    expect(checkpoint?.documents["pi-import:session-resume:leaf:b"]?.status).toBe("queued");

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
    expect(retainedOptions.documentId).toBe("pi-import:session-resume:leaf:b");
    expect(result.documents.map((document) => [document.leafId, document.status])).toEqual([
      ["a", "skipped"],
      ["b", "completed"],
    ]);
    const resumedCheckpoint = await readImportCheckpoint(result.checkpointPath);
    expect(resumedCheckpoint?.documents["pi-import:session-resume:leaf:a"]?.status).toBe(
      "completed",
    );
    expect(resumedCheckpoint?.documents["pi-import:session-resume:leaf:b"]?.status).toBe(
      "completed",
    );
    const manifest = await readImportManifest(result.manifestPath);
    expect(Object.keys(manifest.imports).sort()).toEqual([
      "pi-import:session-resume:leaf:a",
      "pi-import:session-resume:leaf:b",
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

      expect(result.documents[0]?.documentId).toBe("pi-import:session-normalized:leaf:root");
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

    const result = await discoverProjectSessionFiles({ cwd: project, currentSessionFile: current });

    expect(result.scanned).toBe(3);
    expect(result.sessionFiles).toEqual([current, related].sort());
  });

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
    expect(retainedOptions.documentId).toBe("pi-import:second:leaf:1");
    expect(result.imported.map((item) => [item.sessionFile, item.documents[0]?.status])).toEqual([
      [first, "skipped"],
      [second, "completed"],
    ]);
    expect(result.imported[0]?.checkpointPath).not.toBe(result.imported[1]?.checkpointPath);
  });

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
});
