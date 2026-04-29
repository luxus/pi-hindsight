import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { stableSessionId } from "../extensions/session.js";

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
        JSON.stringify({ type: "custom", data: {} }),
      ].join("\n"),
    );
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({ id: "1", role: "user", content: "hi" });
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
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          timestamp: "t1",
          message: { role: "user", content: "hi" },
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
          parentId: "root",
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
    expect(calls[0]?.[1]).toContain(parentSessionId);
    expect(calls[0]?.[1]).toContain(parentSessionFile);
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
        tags: expect.arrayContaining(["import:historical", "forked:true"]),
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
    ).rejects.toThrow(/interrupted/);

    const checkpoint = await readImportCheckpoint(
      join(dir, ".pi/hindsight/import-checkpoint.json"),
    );
    expect(checkpoint?.documents["pi-import:session-resume:leaf:a"]?.status).toBe("completed");
    expect(checkpoint?.documents["pi-import:session-resume:leaf:b"]?.status).toBe("failed");

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
    ).rejects.toThrow(/interrupted/);

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
