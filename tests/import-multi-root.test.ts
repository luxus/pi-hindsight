import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  discoverMultiRootPiSessionHeaders,
  importMultiRootProjectSessions,
} from "../extensions/imports/import-multi-root.js";
import type {
  importProjectSessions,
  ImportProjectSessionsResult,
} from "../extensions/imports/import-sessions.js";

type ImportProjectSessionsArgs = Parameters<typeof importProjectSessions>[0];

function sessionJsonl(args: { id: string; cwd: string; content?: string }): string {
  return [
    JSON.stringify({ type: "session", id: args.id, cwd: args.cwd }),
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: null,
      message: { role: "user", content: args.content ?? "import me" },
    }),
  ].join("\n");
}

function projectResult(args: {
  sessionFile: string;
  dryRun: boolean;
  documentCount?: number;
  messageCount?: number;
}): ImportProjectSessionsResult {
  return {
    sessionFiles: [args.sessionFile],
    scanned: 1,
    imported: [],
    messageCount: args.messageCount ?? 1,
    documentCount: args.documentCount ?? 1,
    dryRun: args.dryRun,
    malformedLineCount: 0,
  };
}

describe("multi-root Pi session import orchestration", () => {
  it("discovers only valid session headers under approved roots and groups canonical cwd values", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-"));
    const unapproved = mkdtempSync(join(tmpdir(), "pi-hindsight-unapproved-root-"));
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const equivalent = join(project, "nested", "..");
    mkdirSync(join(project, "nested"));
    mkdirSync(join(root, "nested"));
    const first = join(root, "first.jsonl");
    const second = join(root, "nested", "second.jsonl");
    const invalidHeader = join(root, "invalid-header.jsonl");
    const malformedHeader = join(root, "malformed-header.jsonl");
    const outside = join(unapproved, "outside.jsonl");
    writeFileSync(first, sessionJsonl({ id: "first", cwd: project }));
    writeFileSync(second, sessionJsonl({ id: "second", cwd: equivalent }));
    writeFileSync(invalidHeader, JSON.stringify({ type: "session", id: "no-cwd" }));
    writeFileSync(malformedHeader, "{not json}\n");
    writeFileSync(outside, sessionJsonl({ id: "outside", cwd: project, content: "outside root" }));
    const canonicalProject = realpathSync(project);
    const canonicalRoot = realpathSync(root);

    const result = await discoverMultiRootPiSessionHeaders({ approvedRoots: [root] });

    expect(result.scannedFileCount).toBe(4);
    expect(result.validSessionCount).toBe(2);
    expect(result.invalidSessionCount).toBe(2);
    expect(result.groups).toEqual([
      {
        cwd: canonicalProject,
        sessions: [
          { sessionFile: join(canonicalRoot, "first.jsonl"), sessionId: "first" },
          { sessionFile: join(canonicalRoot, "nested", "second.jsonl"), sessionId: "second" },
        ],
      },
    ]);
    expect(result.invalidSessions.map((item) => item.sessionFile).sort()).toEqual([
      join(canonicalRoot, "invalid-header.jsonl"),
      join(canonicalRoot, "malformed-header.jsonl"),
    ]);
    expect(JSON.stringify(result)).not.toContain("outside root");
    expect(JSON.stringify(result)).not.toContain(outside);
  });

  it("delegates grouped roots through dry-run first and aggregates terminal outcomes", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-b-"));
    const projectA = mkdtempSync(join(tmpdir(), "pi-hindsight-project-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "pi-hindsight-project-b-"));
    const fileA = join(rootA, "a.jsonl");
    const fileB = join(rootB, "b.jsonl");
    writeFileSync(fileA, sessionJsonl({ id: "a", cwd: projectA }));
    writeFileSync(fileB, sessionJsonl({ id: "b", cwd: projectB }));
    const canonicalRootA = realpathSync(rootA);
    const canonicalRootB = realpathSync(rootB);
    const canonicalProjectA = realpathSync(projectA);
    const canonicalProjectB = realpathSync(projectB);
    const calls: Array<{ cwd: string; searchDir: string; dryRun?: boolean }> = [];
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) => {
      calls.push({
        cwd: args.cwd,
        searchDir: args.searchDir ?? "",
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      });
      if (args.cwd === canonicalProjectB && args.dryRun === false) {
        throw new Error("offline token sk-live-secret-123456");
      }
      return projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      });
    });

    const result = await importMultiRootProjectSessions(
      {
        approvedRoots: [rootA, rootB],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
        dryRunFirst: true,
      },
      { importProjectSessions: delegate },
    );

    expect(calls).toEqual([
      { cwd: canonicalProjectA, searchDir: canonicalRootA, dryRun: true },
      { cwd: canonicalProjectB, searchDir: canonicalRootB, dryRun: true },
      { cwd: canonicalProjectA, searchDir: canonicalRootA, dryRun: false },
      { cwd: canonicalProjectB, searchDir: canonicalRootB, dryRun: false },
    ]);
    expect(result.summary).toMatchObject({
      approvedRootCount: 2,
      validSessionCount: 2,
      invalidSessionCount: 0,
      groupCount: 2,
      dryRunGroupCount: 2,
      importedGroupCount: 1,
      failedGroupCount: 1,
      documentCount: 2,
      messageCount: 2,
    });
    expect(result.summary.categoryCounts).toEqual({
      unreadable: 0,
      "invalid-header": 0,
      "dry-run-completed": 0,
      "dry-run-failed": 0,
      imported: 1,
      "import-failed": 1,
    });
    expect(result.groups.map((group) => group.status)).toEqual(["imported", "import-failed"]);
    expect(result.groups[1]).toMatchObject({
      cwd: canonicalProjectB,
      status: "import-failed",
      error: "offline token [REDACTED_API_KEY]",
    });
    expect(delegate).toHaveBeenCalledTimes(4);
  });

  it("defaults write imports to no preflight unless dryRunFirst is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-"));
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    writeFileSync(join(root, "session.jsonl"), sessionJsonl({ id: "session", cwd: project }));
    const canonicalRoot = realpathSync(root);
    const canonicalProject = realpathSync(project);
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) =>
      projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      }),
    );

    await importMultiRootProjectSessions(
      {
        approvedRoots: [root],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      },
      { importProjectSessions: delegate },
    );

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: canonicalProject, searchDir: canonicalRoot, dryRun: false }),
    );
  });

  it("preflights every group before starting writes when dryRunFirst is requested", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-b-"));
    const projectA = mkdtempSync(join(tmpdir(), "pi-hindsight-project-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "pi-hindsight-project-b-"));
    writeFileSync(join(rootA, "a.jsonl"), sessionJsonl({ id: "a", cwd: projectA }));
    writeFileSync(join(rootB, "b.jsonl"), sessionJsonl({ id: "b", cwd: projectB }));
    const canonicalRootA = realpathSync(rootA);
    const canonicalRootB = realpathSync(rootB);
    const canonicalProjectA = realpathSync(projectA);
    const canonicalProjectB = realpathSync(projectB);
    const calls: Array<{ cwd: string; searchDir: string; dryRun?: boolean }> = [];
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) => {
      calls.push({
        cwd: args.cwd,
        searchDir: args.searchDir ?? "",
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      });
      if (args.cwd === canonicalProjectB && args.dryRun === true) {
        throw new Error("preflight failed with sk-live-secret-abcdef");
      }
      return projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      });
    });

    const result = await importMultiRootProjectSessions(
      {
        approvedRoots: [rootA, rootB],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
        dryRunFirst: true,
      },
      { importProjectSessions: delegate },
    );

    expect(calls).toEqual([
      { cwd: canonicalProjectA, searchDir: canonicalRootA, dryRun: true },
      { cwd: canonicalProjectB, searchDir: canonicalRootB, dryRun: true },
    ]);
    expect(result.groups.map((group) => group.status)).toEqual([
      "dry-run-completed",
      "dry-run-failed",
    ]);
    expect(result.groups[1]?.error).toBe("preflight failed with [REDACTED_API_KEY]");
    expect(JSON.stringify(result)).not.toContain("sk-live-secret-abcdef");
  });

  it("reports deterministic category counts for mixed dry-run-first outcomes", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-b-"));
    const missingRoot = join(tmpdir(), `pi-hindsight-missing-${Date.now()}`);
    const projectA = mkdtempSync(join(tmpdir(), "pi-hindsight-project-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "pi-hindsight-project-b-"));
    writeFileSync(join(rootA, "a.jsonl"), sessionJsonl({ id: "a", cwd: projectA }));
    writeFileSync(join(rootA, "invalid.jsonl"), JSON.stringify({ type: "session", id: "no-cwd" }));
    writeFileSync(join(rootB, "b.jsonl"), sessionJsonl({ id: "b", cwd: projectB }));
    const canonicalProjectB = realpathSync(projectB);
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) => {
      if (args.cwd === canonicalProjectB && args.dryRun === false) {
        throw new Error("import failed with sk-live-secret-category");
      }
      return projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      });
    });

    const result = await importMultiRootProjectSessions(
      {
        approvedRoots: [rootA, rootB, missingRoot],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
        dryRunFirst: true,
      },
      { importProjectSessions: delegate },
    );

    expect(result.summary.categoryCounts).toEqual({
      unreadable: 1,
      "invalid-header": 1,
      "dry-run-completed": 0,
      "dry-run-failed": 0,
      imported: 1,
      "import-failed": 1,
    });
    expect(JSON.stringify(result)).not.toContain("sk-live-secret-category");
  });

  it("reports deterministic category counts for mixed normal write outcomes", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-b-"));
    const projectA = mkdtempSync(join(tmpdir(), "pi-hindsight-project-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "pi-hindsight-project-b-"));
    writeFileSync(join(rootA, "a.jsonl"), sessionJsonl({ id: "a", cwd: projectA }));
    writeFileSync(join(rootA, "invalid.jsonl"), "not-json\n");
    writeFileSync(join(rootB, "b.jsonl"), sessionJsonl({ id: "b", cwd: projectB }));
    const canonicalProjectB = realpathSync(projectB);
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) => {
      if (args.cwd === canonicalProjectB && args.dryRun === false) {
        throw new Error("write failed with sk-live-secret-normal");
      }
      return projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      });
    });

    const result = await importMultiRootProjectSessions(
      {
        approvedRoots: [rootA, rootB],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
      },
      { importProjectSessions: delegate },
    );

    expect(result.summary.categoryCounts).toEqual({
      unreadable: 0,
      "invalid-header": 1,
      "dry-run-completed": 0,
      "dry-run-failed": 0,
      imported: 1,
      "import-failed": 1,
    });
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("sk-live-secret-normal");
  });

  it("deduplicates sessions found through overlapping approved roots by canonical file path", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-"));
    const child = join(root, "child");
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    mkdirSync(child);
    const file = join(child, "session.jsonl");
    writeFileSync(file, sessionJsonl({ id: "session", cwd: project }));
    const canonicalFile = realpathSync(file);

    const result = await discoverMultiRootPiSessionHeaders({ approvedRoots: [root, child] });

    expect(result.scannedFileCount).toBe(1);
    expect(result.validSessionCount).toBe(1);
    expect(result.groups).toEqual([
      {
        cwd: realpathSync(project),
        sessions: [{ sessionFile: canonicalFile, sessionId: "session" }],
      },
    ]);
  });

  it("reads only the bounded header prefix and does not surface later session body content", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-"));
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    writeFileSync(
      join(root, "session.jsonl"),
      [
        JSON.stringify({ type: "session", id: "session", cwd: project }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: `do not read this body token sk-live-secret-${"x".repeat(70_000)}`,
          },
        }),
      ].join("\n"),
    );

    const result = await discoverMultiRootPiSessionHeaders({ approvedRoots: [root] });

    expect(result.validSessionCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("do not read this body token");
    expect(JSON.stringify(result)).not.toContain("sk-live-secret");
  });

  it("stops after dry-run delegation when requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-import-root-"));
    const project = mkdtempSync(join(tmpdir(), "pi-hindsight-project-"));
    const file = join(root, "session.jsonl");
    writeFileSync(file, sessionJsonl({ id: "session", cwd: project }));
    const canonicalRoot = realpathSync(root);
    const canonicalProject = realpathSync(project);
    const delegate = vi.fn(async (args: ImportProjectSessionsArgs) =>
      projectResult({
        sessionFile: join(args.searchDir ?? "", "placeholder.jsonl"),
        dryRun: Boolean(args.dryRun),
      }),
    );

    const result = await importMultiRootProjectSessions(
      {
        approvedRoots: [root],
        bankId: "bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        },
        dryRun: true,
      },
      { importProjectSessions: delegate },
    );

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: canonicalProject, searchDir: canonicalRoot, dryRun: true }),
    );
    expect(result.groups[0]).toMatchObject({ status: "dry-run-completed" });
    expect(result.summary).toMatchObject({
      dryRunGroupCount: 1,
      importedGroupCount: 0,
      failedGroupCount: 0,
      documentCount: 1,
      messageCount: 1,
    });
  });
});
