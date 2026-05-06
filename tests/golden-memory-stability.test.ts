import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
import { createRetainTurnPolicy } from "../extensions/memory-lifecycle-retain.js";
import type { RuntimeSnapshot } from "../extensions/memory-lifecycle-runtime.js";
import { readImportCheckpoint } from "../extensions/import-checkpoint.js";
import { readImportManifest } from "../extensions/import-manifest.js";
import { readRetainQueue, resolveQueuePath } from "../extensions/queue.js";
import { liveDocumentId, stableSessionId } from "../extensions/session.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";

type RetainOptions = NonNullable<Parameters<HindsightLikeClient["retain"]>[2]>;

interface RetainWrite {
  bankId: string;
  content: string;
  options: RetainOptions;
}

function makeCwd(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function writePiSession(
  path: string,
  cwd: string,
  sessionId: string,
  messages: Array<{
    id: string;
    parentId?: string | null;
    role: string;
    content: string;
  }>,
): void {
  writeFileSync(
    path,
    [
      JSON.stringify({ type: "session", id: sessionId, cwd }),
      ...messages.map((message, index) =>
        JSON.stringify({
          type: "message",
          id: message.id,
          parentId: message.parentId ?? (index === 0 ? null : messages[index - 1]?.id),
          message: { role: message.role, content: message.content },
        }),
      ),
    ].join("\n"),
  );
}

function createMemoryStore(args: { failWrites?: number } = {}) {
  let failuresRemaining = args.failWrites ?? 0;
  const attempts: RetainWrite[] = [];
  const writes: RetainWrite[] = [];
  const logicalDocuments = new Map<string, RetainWrite>();
  const client: HindsightLikeClient = {
    retain: async (bankId, content, options = {}) => {
      const write = { bankId, content, options };
      attempts.push(write);
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("offline");
      }
      const documentId = options.documentId ?? `generated:${attempts.length}`;
      logicalDocuments.set(`${bankId}:${documentId}`, write);
      writes.push(write);
    },
    recall: async () => [],
    reflect: async () => ({}),
  };
  return { client, attempts, writes, logicalDocuments };
}

function operations(args: {
  client: HindsightLikeClient;
  config?: ResolvedConfig;
  projectBankId?: string;
}) {
  const config = args.config ?? DEFAULT_CONFIG;
  return createMemoryOperations({
    getClient: () => args.client,
    getConfig: () => config,
    getProjectBankId: () => args.projectBankId ?? "project-bank",
  });
}

function expectProjectTags(tags: string[] | undefined, cwd: string, sessionId: string): void {
  expect(tags).toEqual(
    expect.arrayContaining(["source:pi", `session:${sessionId}`, expect.stringMatching(/^repo:/)]),
  );
  expect(tags?.filter((tag) => tag.startsWith("repo:"))).toHaveLength(1);
  expect(tags?.filter((tag) => tag === `session:${sessionId}`)).toHaveLength(1);
  expect(tags?.join("\n")).not.toContain(cwd);
}

describe("golden memory stability", () => {
  it("keeps explicit retain document identity, update mode, tags, and provenance stable across repeats and restarts", async () => {
    const cwd = makeCwd("pi-hindsight-golden-explicit-");
    const sessionFile = join(cwd, "session.jsonl");
    const store = createMemoryStore();
    const memory = operations({ client: store.client });
    const args = {
      cwd,
      sessionFile,
      content: "remember stable explicit fact",
      context: "user requested explicit retention",
      tags: ["kind:golden"],
      metadata: { source_id: "explicit-fixture" },
    };

    const first = await memory.retainExplicit(args);
    const afterRestart = operations({ client: store.client });
    const second = await afterRestart.retainExplicit({ ...args });

    expect(second.documentId).toBe(first.documentId);
    expect(first.updateMode).toBe("replace");
    expect(second.updateMode).toBe("replace");
    expect(store.logicalDocuments.size).toBe(1);
    expect(store.writes.map((write) => write.options.documentId)).toEqual([
      first.documentId,
      first.documentId,
    ]);

    const options = store.writes[0]?.options;
    expect(options).toMatchObject({
      documentId: first.documentId,
      updateMode: "replace",
      context: "user requested explicit retention",
      metadata: {
        cwd,
        pi_session_file: sessionFile,
        source: "pi-hindsight",
        retainSource: "tool",
        source_id: "explicit-fixture",
      },
    });
    expectProjectTags(options?.tags, cwd, stableSessionId(sessionFile, cwd));
    expect(options?.tags).toContain("kind:golden");

    await memory.retainExplicit({ ...args, documentId: "manual-explicit-doc" });
    expect(store.logicalDocuments.size).toBe(2);
    expect(store.logicalDocuments.has("project-bank:manual-explicit-doc")).toBe(true);
  });

  it("keeps automatic retain on one live document and restart cursor prevents duplicate logical documents", async () => {
    const cwd = makeCwd("pi-hindsight-golden-auto-");
    const sessionFile = join(cwd, "session.jsonl");
    const store = createMemoryStore();
    const statuses: string[] = [];
    const runtime: RuntimeSnapshot = {
      cwd,
      sessionFile,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    const event = {
      messages: [
        { id: "u1", role: "user", content: "remember stable auto fact", timestamp: 1 },
        { id: "a1", role: "assistant", content: "stable auto fact retained", timestamp: 2 },
      ],
    } as unknown as AgentEndEvent;
    const newPolicy = () =>
      createRetainTurnPolicy({
        getConfig: () => DEFAULT_CONFIG,
        getClient: () => store.client,
        getProjectBankId: () => "project-bank",
        getCapabilities: () => undefined,
        setMemoryStatus: (_runtime, activity) => statuses.push(activity),
        notify: () => undefined,
      });

    const first = await newPolicy().retain(event, runtime);
    const second = await newPolicy().retain({ ...event }, runtime);

    expect(first).toMatchObject({ queued: true, sent: 1, remaining: 0 });
    expect(second).toMatchObject({ queued: false, sent: 0, remaining: 0 });
    expect(store.writes).toHaveLength(1);
    expect(store.logicalDocuments.size).toBe(1);

    const options = store.writes[0]?.options;
    expect(options).toMatchObject({
      documentId: liveDocumentId(sessionFile, cwd),
      updateMode: "append",
      metadata: { cwd, imported: "false", pi_session_file: sessionFile },
    });
    expectProjectTags(options?.tags, cwd, stableSessionId(sessionFile, cwd));
    await expect(
      readRetainQueue(resolveQueuePath(cwd, DEFAULT_CONFIG.retain.queuePath)),
    ).resolves.toEqual([]);
    expect(statuses).toContain("retained");
  });

  it("resumes and reimports single-session imports with deterministic IDs, tags, provenance, manifest, and checkpoint", async () => {
    const cwd = makeCwd("pi-hindsight-golden-import-one-");
    const sessionFile = join(cwd, "session.jsonl");
    writePiSession(sessionFile, cwd, "single-session-stability", [
      { id: "user-1", role: "user", content: "import stable memory" },
      { id: "assistant-1", role: "assistant", content: "stable imported memory" },
    ]);
    const documentId =
      "pi-import:single-session-stability:leaf:assistant-1:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1";
    const store = createMemoryStore({ failWrites: 1 });

    await expect(
      operations({ client: store.client }).importSession({ sessionFile, cwd }),
    ).rejects.toThrow(/queued/);
    const queuedCheckpoint = await readImportCheckpoint(
      join(cwd, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(queuedCheckpoint?.updateMode).toBe("replace");
    expect(queuedCheckpoint?.documents[documentId]).toMatchObject({
      documentId,
      status: "queued",
      contentHash: expect.any(String),
    });

    const resumed = await operations({ client: store.client }).importSession({ sessionFile, cwd });
    const reimported = await operations({ client: store.client }).importSession({
      sessionFile,
      cwd,
    });

    expect(resumed.documents.map((document) => document.documentId)).toEqual([documentId]);
    expect(reimported.documents).toEqual([
      expect.objectContaining({ documentId, status: "skipped", wouldWrite: false }),
    ]);
    expect(store.writes).toHaveLength(1);
    expect(store.logicalDocuments.size).toBe(1);
    await expect(
      readRetainQueue(resolveQueuePath(cwd, DEFAULT_CONFIG.retain.queuePath)),
    ).resolves.toEqual([]);

    const options = store.writes[0]?.options;
    expect(options).toMatchObject({
      documentId,
      updateMode: "replace",
      metadata: {
        pi_session_file: sessionFile,
        imported: "true",
        cwd,
        session_id: "single-session-stability",
        branch_leaf_id: "assistant-1",
        import_mode: "curated",
        content_hash: resumed.documents[0]?.contentHash,
        include_branches: "current-only",
        tool_results: "errors-only",
      },
    });
    expect(options?.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        "import:historical",
        "imported:true",
        "session:single-session-stability",
        "branch:assistant-1",
        `document:${documentId}`,
        expect.stringMatching(/^repo:/),
      ]),
    );

    const completedCheckpoint = await readImportCheckpoint(resumed.checkpointPath);
    const manifest = await readImportManifest(resumed.manifestPath);
    expect(completedCheckpoint?.runId).toBe(resumed.runId);
    expect(completedCheckpoint?.documents[documentId]).toMatchObject({
      documentId,
      status: "completed",
      contentHash: resumed.documents[0]?.contentHash,
      messageCount: 2,
      importMode: "curated",
      projectionVersion: "curated-turns-v1",
      importProfile: "turns-12-bytes-80000",
    });
    expect(manifest.imports[documentId]).toMatchObject({
      documentId,
      bankId: "project-bank",
      sourceFile: sessionFile,
      contentHash: resumed.documents[0]?.contentHash,
      messageCount: 2,
      leafId: "assistant-1",
      sessionId: "single-session-stability",
      cwd,
      includeBranches: "current-only",
      updateMode: "replace",
    });
    expect(Object.keys(manifest.imports)).toEqual([documentId]);
  });

  it("reimports project sessions without duplicate logical documents and keeps per-file checkpoints aligned to manifest", async () => {
    const cwd = makeCwd("pi-hindsight-golden-project-");
    const sessionsDir = mkdtempSync(join(tmpdir(), "pi-hindsight-golden-project-sessions-"));
    const firstSession = join(sessionsDir, "first.jsonl");
    const secondSession = join(sessionsDir, "second.jsonl");
    writePiSession(firstSession, cwd, "project-session-one", [
      { id: "one-u", role: "user", content: "project import one" },
      { id: "one-a", role: "assistant", content: "project import one stable" },
    ]);
    writePiSession(secondSession, cwd, "project-session-two", [
      { id: "two-u", role: "user", content: "project import two" },
    ]);
    const expected = [
      "pi-import:project-session-one:leaf:one-a:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
      "pi-import:project-session-two:leaf:two-u:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-0",
    ];
    const store = createMemoryStore();
    const memory = operations({ client: store.client });

    const first = await memory.importProjectSessions({ cwd, searchDir: sessionsDir });
    const second = await operations({ client: store.client }).importProjectSessions({
      cwd,
      searchDir: sessionsDir,
    });

    expect(
      first.imported.flatMap((item) => item.documents.map((document) => document.documentId)),
    ).toEqual(expected);
    expect(
      second.imported.flatMap((item) => item.documents.map((document) => document.status)),
    ).toEqual(["skipped", "skipped"]);
    expect(store.writes.map((write) => write.options.documentId)).toEqual(expected);
    expect(store.logicalDocuments.size).toBe(2);
    expect(new Set(first.imported.map((item) => item.checkpointPath)).size).toBe(2);

    const manifest = await readImportManifest(first.imported[0]!.manifestPath);
    expect(Object.keys(manifest.imports).sort()).toEqual([...expected].sort());
    for (const [index, result] of first.imported.entries()) {
      const document = result.documents[0]!;
      const options = store.writes[index]!.options;
      expect(options).toMatchObject({
        documentId: document.documentId,
        updateMode: "replace",
        metadata: expect.objectContaining({
          pi_session_file: result.sessionFile,
          imported: "true",
          cwd,
          session_id: index === 0 ? "project-session-one" : "project-session-two",
          branch_leaf_id: index === 0 ? "one-a" : "two-u",
          content_hash: document.contentHash,
        }),
      });
      const sessionId = index === 0 ? "project-session-one" : "project-session-two";
      const branchId = index === 0 ? "one-a" : "two-u";
      expect(options.tags).toEqual(
        expect.arrayContaining([
          "source:pi",
          "import:historical",
          "imported:true",
          `session:${sessionId}`,
          `branch:${branchId}`,
          `document:${document.documentId}`,
          expect.stringMatching(/^repo:/),
        ]),
      );

      const checkpoint = await readImportCheckpoint(result.checkpointPath);
      expect(checkpoint?.documents[document.documentId]).toMatchObject({
        documentId: document.documentId,
        status: "completed",
        contentHash: document.contentHash,
        messageCount: document.messageCount,
      });
      expect(manifest.imports[document.documentId]).toMatchObject({
        documentId: document.documentId,
        sourceFile: result.sessionFile,
        contentHash: document.contentHash,
        messageCount: document.messageCount,
        updateMode: "replace",
      });
    }
  });
});
