import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueRetainJob, readRetainQueue, resolveQueuePath } from "../extensions/queue/queue.js";
import {
  addSessionMemoryTag,
  readSessionMemoryMeta,
  setNextSessionRetainMode,
  setSessionMemoryMode,
  setSessionRetainEnabled,
} from "../extensions/utils/session-memory-meta.js";
import { liveDocumentId, stableSessionId } from "../extensions/utils/session.js";
import type { RetainJob } from "../extensions/types.js";

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 500,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const mocked = vi.hoisted(() => ({
  client: {
    retain: vi.fn(async (..._args: unknown[]) => undefined),
    recall: vi.fn(async (..._args: unknown[]) => ({
      results: [{ text: "repo-specific remembered fact" }],
    })),
    reflect: vi.fn(async (..._args: unknown[]) => ({})),
    createBank: vi.fn(async (..._args: unknown[]) => undefined),
    getBankProfile: vi.fn(async (..._args: unknown[]) => ({})),
    deleteDocument: vi.fn(async (..._args: unknown[]) => ({ success: true })),
  },
  ensureGlobalBank: vi.fn(async () => undefined),
  ensureProjectBank: vi.fn(async () => undefined),
  checkHindsight: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../extensions/client/client.js", () => ({
  createHindsightClient: () => mocked.client,
  checkHindsight: mocked.checkHindsight,
}));

vi.mock("../extensions/banks/bank-operations.js", () => ({
  ensureGlobalBank: mocked.ensureGlobalBank,
  ensureProjectBank: mocked.ensureProjectBank,
}));

describe("extension hooks", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "pi-hindsight-home-"));
    vi.useRealTimers();
    vi.clearAllMocks();
    mocked.client.recall.mockImplementation(async (..._args: unknown[]) => ({
      results: [{ text: "repo-specific remembered fact" }],
    }));
    mocked.client.retain.mockImplementation(async (..._args: unknown[]) => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("marks startup status connected after bank ensure succeeds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const lifecycle = createMemoryLifecycle(cwd);
    await lifecycle.initialize(ctx);

    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "hindsight",
      expect.stringContaining("connected"),
    );
    expect(lifecycle.deps.getInitHealth()).toMatchObject({ failures: [] });
  });

  it("records inspectable init failures when bank ensure fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    mocked.ensureProjectBank.mockRejectedValueOnce(new Error("bank ensure exploded"));
    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const lifecycle = createMemoryLifecycle(cwd);
    await lifecycle.initialize(ctx);

    expect(lifecycle.deps.getInitHealth()).toMatchObject({
      failures: [
        expect.objectContaining({
          subsystem: "project-bank",
          error: expect.stringContaining("bank ensure exploded"),
        }),
      ],
    });
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "hindsight",
      expect.stringContaining("offline"),
    );
    const warningCalls = (ctx.ui.notify.mock.calls as Array<[string, string]>).filter(([message]) =>
      message.includes("project bank ensure failed"),
    );
    expect(warningCalls).toHaveLength(1);
  });

  it("notifies when startup migrates legacy global memory config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ banks: { global: { enabled: true, bankId: "global-bank" } } }),
    );
    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    await createMemoryLifecycle(cwd).initialize(ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Migrated Hindsight memory config from global to user keys"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Backups:"), "info");
  });

  it("marks startup status offline after bank ensure fails", async () => {
    mocked.ensureProjectBank.mockRejectedValueOnce(new Error("down"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    await createMemoryLifecycle(cwd).initialize(ctx);

    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "hindsight",
      expect.stringContaining("offline"),
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Hindsight project bank ensure failed"),
      "warning",
    );
  });

  it("appends recalled memory before current user by default and keeps that block out of retained transcript content", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    const sessionFile = join(cwd, "session.jsonl");

    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);

    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    const originalMessages = [
      { role: "assistant", content: "Earlier context", timestamp: Date.now() - 1 },
      { role: "user", content: "What did we decide?", timestamp: Date.now() },
    ];
    const contextResult = await handlers.context?.[0]?.({ messages: originalMessages }, ctx);

    expect(contextResult.messages[0]).toEqual(originalMessages[0]);
    expect(contextResult.messages[1].role).toBe("user");
    expect(contextResult.messages[1].content).toContain("<hindsight-memory>");
    expect(contextResult.messages[1].content).toContain("repo-specific remembered fact");
    expect(contextResult.messages.at(-1)).toEqual(originalMessages[1]);

    await handlers.agent_end?.[0]?.(
      {
        messages: [
          ...originalMessages,
          contextResult.messages[1],
          { role: "assistant", content: "Decision still stands.", timestamp: Date.now() },
        ],
      },
      ctx,
    );

    const retainCalls = (mocked.client.retain.mock.calls as unknown[][]).filter(
      (call) => call[1] !== "Pi Hindsight append capability probe. Safe to ignore.",
    );
    expect(retainCalls).toHaveLength(1);
    const retainedContent = retainCalls[0]?.[1] as string;
    expect(retainedContent).toContain("What did we decide?");
    expect(retainedContent).toContain("Decision still stands.");
    expect(retainedContent).not.toContain("<hindsight-memory>");
    expect(retainedContent).not.toContain("repo-specific remembered fact");
  }, 20_000);

  // Windows CI is flaky for this fake-timer + async queue file IO path. Non-Windows
  // PR checks keep coverage while #139 defines tiered CI and future deterministic Windows proof.
  const itIfPeriodicFlushHookReliable = process.platform === "win32" ? it.skip : it;

  itIfPeriodicFlushHookReliable(
    "flushes queued retain jobs on the configured interval",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".pi"));
      writeFileSync(
        join(cwd, ".pi", "hindsight.json"),
        JSON.stringify({
          hindsight: { baseUrl: "http://unused.test" },
          retain: { flushIntervalMs: 1_000, periodicFlushMaxJobs: 1, shutdownFlushMaxJobs: 10 },
        }),
      );
      const queuePath = resolveQueuePath(cwd, ".pi/hindsight/retain-queue.jsonl");
      await enqueueRetainJob(queuePath, {
        id: "queued",
        bankId: "bank",
        createdAt: new Date().toISOString(),
        documentId: "doc",
        updateMode: "append",
        item: { content: "content", context: "context" },
        retries: 0,
      });
      const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
      const pi = {
        on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
          handlers[name] = [...(handlers[name] ?? []), handler];
        }),
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
      };
      const ctx = {
        cwd,
        ui: { setStatus: vi.fn(), notify: vi.fn() },
        sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
      };

      try {
        const { default: hindsightExtension } = await import("../extensions/index.js");
        hindsightExtension(pi as any);
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        await handlers.session_start?.[0]?.({}, ctx);
        await enqueueRetainJob(queuePath, {
          id: "queued-2",
          bankId: "bank",
          createdAt: new Date().toISOString(),
          documentId: "doc-2",
          updateMode: "append",
          item: { content: "content-2", context: "context" },
          retries: 0,
        });
        mocked.client.retain.mockClear();
        await vi.advanceTimersByTimeAsync(1_000);
        const periodicFlushWaitMs = process.platform === "win32" ? 60_000 : 5_000;
        await waitForCondition(async () => {
          const queue = await readRetainQueue(queuePath);
          return (
            mocked.client.retain.mock.calls.length === 1 &&
            queue.length === 1 &&
            queue[0]?.id === "queued-2"
          );
        }, periodicFlushWaitMs);

        expect(mocked.client.retain).toHaveBeenCalledTimes(1);
        expect((await readRetainQueue(queuePath)).map((job) => job.id)).toEqual(["queued-2"]);
        expect(mocked.client.retain).toHaveBeenCalledWith(
          "bank",
          "content",
          expect.objectContaining({ documentId: "doc", updateMode: "append" }),
        );
      } finally {
        await handlers.session_shutdown?.[0]?.({}, ctx);
        vi.useRealTimers();
      }
    },
    70_000,
  );

  it("skips automatic retain once for next opt-out and advances retain cursor", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();

    const skippedMessages = [
      { role: "user", content: "Do not retain this", timestamp: 1 },
      { role: "assistant", content: "Skipped answer", timestamp: 2 },
    ];
    await handlers.agent_end?.[0]?.({ messages: skippedMessages }, ctx);

    expect(mocked.client.retain).not.toHaveBeenCalled();
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("normal");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Hindsight skipped retain for this run due to next-opt-out.",
      "info",
    );

    await handlers.agent_end?.[0]?.(
      {
        messages: [
          ...skippedMessages,
          { role: "user", content: "Retain this later", timestamp: 3 },
          { role: "assistant", content: "Retained answer", timestamp: 4 },
        ],
      },
      ctx,
    );

    expect(mocked.client.retain).toHaveBeenCalledTimes(1);
    const retainedContent = mocked.client.retain.mock.calls[0]?.[1] as string;
    expect(retainedContent).not.toContain("Do not retain this");
    expect(retainedContent).not.toContain("Skipped answer");
    expect(retainedContent).toContain("Retain this later");
    expect(retainedContent).toContain("Retained answer");
  });

  it("still recalls while next opt-out is pending", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);

    const recall = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "q", timestamp: 1 }] },
      ctx,
    );

    expect(mocked.client.recall).toHaveBeenCalled();
    expect(recall.messages[0].content).toContain("<hindsight-memory>");
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");
  });

  it("retains global memory through configured global bank", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-tools-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ banks: { global: { enabled: true, bankId: "global-luxus" } } }),
    );
    const tools: Record<string, any> = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool: any) => {
        tools[tool.name] = tool;
      }),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    const result = await tools.hindsight_retain_global.execute(
      "tool-call",
      { content: "Kai prefers terse replies", context: "Global user preference" },
      undefined,
      undefined,
      ctx,
    );

    expect(mocked.client.retain).toHaveBeenCalledWith(
      "global-luxus",
      "Kai prefers terse replies",
      expect.objectContaining({ documentId: expect.stringMatching(/^pi-explicit:/) }),
    );
    expect(result.details).toMatchObject({ bankId: "global-luxus" });
  });

  it("registers only the slim memory tool surface", async () => {
    const tools: Record<string, any> = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool: any) => {
        tools[tool.name] = tool;
      }),
      registerCommand: vi.fn(),
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);

    expect(Object.keys(tools).sort()).toEqual([
      "hindsight_recall",
      "hindsight_reflect",
      "hindsight_retain",
      "hindsight_retain_global",
    ]);
  });

  it("writes opt-in last recall snapshot to sidecar", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ recall: { storeLastRecall: true } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "What did we decide?", timestamp: 1 }] },
      ctx,
    );

    const snapshotPath = join(cwd, ".pi", "hindsight", "last-recall.json");
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, any>;
    expect(snapshot.query).toContain("What did we decide?");
    expect(snapshot.rendered).toContain("<hindsight-memory>");
    expect(snapshot.blocks[0].results[0].text).toBe("repo-specific remembered fact");
  });

  it("still injects recall when optional snapshot write fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ recall: { storeLastRecall: true, lastRecallPath: "." } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    const result = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "What did we decide?", timestamp: 1 }] },
      ctx,
    );

    expect(result?.messages[0].content).toContain("<hindsight-memory>");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Hindsight last recall snapshot write failed"),
      "warning",
    );
  });

  it("writes opt-in last recall failure details to sidecar", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        banks: { global: { enabled: false } },
        recall: { storeLastRecall: true, storeLastRecallFailures: true },
      }),
    );
    mocked.client.recall.mockRejectedValue(new Error("Bearer secret-token failed"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    const result = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "Why no memory?", timestamp: 1 }] },
      ctx,
    );

    expect(result).toBeUndefined();
    const snapshotPath = join(cwd, ".pi", "hindsight", "last-recall.json");
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, any>;
    expect(snapshot.failed).toBe(1);
    expect(snapshot.failures[0].bankId).toMatch(/^pi-project-/);
    expect(snapshot.failures[0].query).toContain("Why no memory?");
    expect(snapshot.failures[0].error).not.toContain("secret-token");
  });

  it("does not write all-failed last recall snapshot unless failure debug is enabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        banks: { global: { enabled: false } },
        recall: { storeLastRecall: true },
      }),
    );
    mocked.client.recall.mockRejectedValue(new Error("server unavailable"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "Why no memory?", timestamp: 1 }] },
      ctx,
    );

    expect(existsSync(join(cwd, ".pi", "hindsight", "last-recall.json"))).toBe(false);
  });

  it("does not write last recall snapshot by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "What did we decide?", timestamp: 1 }] },
      ctx,
    );

    expect(existsSync(join(cwd, ".pi", "hindsight", "last-recall.json"))).toBe(false);
  });

  it("uses repo scope for project recall and source scope for global recall", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ banks: { global: { enabled: true, bankId: "global-bank" } } }),
    );
    mocked.client.recall.mockImplementation(async (...args: unknown[]) => ({
      results: [{ text: `${String(args[0])} memory` }],
    }));

    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);

    await handlers.session_start?.[0]?.({}, ctx);
    const contextResult = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "What do I know?", timestamp: 1 }] },
      ctx,
    );

    expect(contextResult.messages[0].role).toBe("user");
    expect(contextResult.messages[0].content).toContain("global-bank memory");
    expect(contextResult.messages.at(-1).content).toBe("What do I know?");
    expect(mocked.client.recall).toHaveBeenCalledTimes(2);
    expect(mocked.client.recall.mock.calls[0]?.[0]).toMatch(/^pi-project-/);
    expect(mocked.client.recall.mock.calls[0]?.[1]).toContain(
      "Project memory lookup for current repo architecture",
    );
    expect(mocked.client.recall.mock.calls[0]?.[1]).toContain("scope:project");
    expect(mocked.client.recall.mock.calls[0]?.[1]).toContain("user: What do I know?");
    expect(mocked.client.recall.mock.calls[0]?.[2]).toMatchObject({
      maxTokens: 800,
      types: ["observation"],
      tagGroups: [{ tags: [expect.stringMatching(/^repo:/)], match: "any_strict" }],
    });
    expect(mocked.client.recall.mock.calls[1]?.[0]).toBe("global-bank");
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain(
      "User memory lookup for durable user preferences",
    );
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain("scope:global");
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain("user: What do I know?");
    expect(mocked.client.recall.mock.calls[1]?.[2]).toMatchObject({
      maxTokens: 400,
      tagGroups: [{ tags: ["source:pi"], match: "any_strict" }],
    });
    expect(mocked.ensureGlobalBank).toHaveBeenCalledWith(
      mocked.client,
      "global-bank",
      expect.objectContaining({ enabled: true, bankId: "global-bank", enableObservations: true }),
    );
  });

  it("honors explicit prepend recall injection position with user role", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ recall: { injectionPosition: "prepend" } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    const original = [{ role: "user", content: "q", timestamp: 1 }];
    const contextResult = await handlers.context?.[0]?.({ messages: original }, ctx);

    expect(contextResult.messages[0].role).toBe("user");
    expect(contextResult.messages[0].content).toContain("<hindsight-memory>");
    expect(contextResult.messages[1]).toEqual(original[0]);
  });

  it("honors explicit append recall injection position", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ recall: { injectionPosition: "append" } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    const original = [{ role: "user", content: "q", timestamp: 1 }];
    const contextResult = await handlers.context?.[0]?.({ messages: original }, ctx);

    expect(contextResult.messages[0].role).toBe("user");
    expect(contextResult.messages[0].content).toContain("<hindsight-memory>");
    expect(contextResult.messages.at(-1)).toEqual(original[0]);
  });

  it("does not append synthetic recall when transcript does not end with user", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    const beforeCalls = mocked.client.recall.mock.calls.length;
    const contextResult = await handlers.context?.[0]?.(
      {
        messages: [
          { role: "user", content: "Use tools", timestamp: 1 },
          { role: "assistant", content: "Calling tool", timestamp: 2 },
          { role: "toolResult", content: "tool output", timestamp: 3 },
        ],
      },
      ctx,
    );

    expect(contextResult).toBeUndefined();
    expect(mocked.client.recall).toHaveBeenCalledTimes(beforeCalls);
  });

  it("ensures global bank even when project bank is disabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        banks: { project: { enabled: false }, global: { enabled: true, bankId: "global-bank" } },
        retain: { enabled: false },
      }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);

    expect(mocked.ensureProjectBank).not.toHaveBeenCalled();
    expect(mocked.ensureGlobalBank).toHaveBeenCalledWith(
      mocked.client,
      "global-bank",
      expect.objectContaining({ enabled: true, bankId: "global-bank" }),
    );
  });

  it("does not run append capability probes when global bank ensure fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ banks: { global: { enabled: true, bankId: "global-bank" } } }),
    );
    mocked.ensureGlobalBank.mockRejectedValueOnce(new Error("global down"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);

    expect(
      mocked.client.retain.mock.calls.some(
        (call) => call[1] === "Pi Hindsight append capability probe. Safe to ignore.",
      ),
    ).toBe(false);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Hindsight global bank ensure failed: global down"),
      "warning",
    );
  });

  it("explicit retain keeps base tags when extra tags are provided", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-tools-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    const tools: Record<string, any> = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool: any) => {
        tools[tool.name] = tool;
      }),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await tools.hindsight_retain.execute(
      "tool-call",
      { content: "Remember config decision", context: "test", tags: ["decision:config"] },
      undefined,
      undefined,
      ctx,
    );

    const retainOptions = mocked.client.retain.mock.calls[0]?.[2] as { tags?: string[] };
    expect(retainOptions.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        "decision:config",
        expect.stringMatching(/^repo:/),
        expect.stringMatching(/^session:/),
      ]),
    );
  });

  it("explicit retain works while next opt-out is pending and does not consume it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-tools-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const tools: Record<string, any> = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool: any) => {
        tools[tool.name] = tool;
      }),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await tools.hindsight_retain.execute(
      "tool-call",
      { content: "Explicit memory", context: "test" },
      undefined,
      undefined,
      ctx,
    );

    expect(mocked.client.retain).toHaveBeenCalledWith(
      expect.any(String),
      "Explicit memory",
      expect.objectContaining({
        updateMode: "replace",
        documentId: expect.stringMatching(/^pi-explicit:/),
      }),
    );
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");
  });

  it("honors session read-only mode and manual tags", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    await addSessionMemoryTag(cwd, sessionFile, "domain:test");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    const recall = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "q", timestamp: 1 }] },
      ctx,
    );
    expect(recall.messages[0].role).toBe("user");
    expect(recall.messages[0].content).toContain("<hindsight-memory>");
    expect(recall.messages.at(-1).content).toBe("q");
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "remember", timestamp: 1 }] },
      ctx,
    );
    expect(mocked.client.retain).not.toHaveBeenCalled();

    await setSessionMemoryMode(cwd, sessionFile, "normal");
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "remember again", timestamp: 2 }] },
      ctx,
    );
    const retainCalls = (mocked.client.retain.mock.calls as unknown[][]).filter(
      (call) => call[1] !== "Pi Hindsight append capability probe. Safe to ignore.",
    );
    expect(retainCalls[0]?.[2]).toMatchObject({ tags: expect.arrayContaining(["domain:test"]) });
  });

  it("keeps next opt-out pending when skipped-message cursor update fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight", "retain-cursors.json"), "not json");
    const sessionFile = join(cwd, "session.jsonl");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };
    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);

    await expect(
      handlers.agent_end?.[0]?.(
        { messages: [{ role: "user", content: "private", timestamp: 1 }] },
        ctx,
      ),
    ).resolves.toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Hindsight retain cursor update failed"),
      "warning",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      "Hindsight skipped retain for this run due to next-opt-out.",
      "info",
    );
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");
  });

  it("does not later retain overlapping messages skipped while read-only", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "read-only");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };
    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();

    const privateMessage = { role: "user", content: "private", timestamp: 1 };
    await handlers.agent_end?.[0]?.({ messages: [privateMessage] }, ctx);
    await setSessionMemoryMode(cwd, sessionFile, "normal");
    await handlers.agent_end?.[0]?.(
      { messages: [privateMessage, { role: "user", content: "public", timestamp: 2 }] },
      ctx,
    );

    const retainCalls = (mocked.client.retain.mock.calls as unknown[][]).filter(
      (call) => call[1] !== "Pi Hindsight append capability probe. Safe to ignore.",
    );
    expect(retainCalls).toHaveLength(1);
    expect(retainCalls[0]?.[1]).toContain("public");
    expect(retainCalls[0]?.[1]).not.toContain("private");
  });

  it("keeps read-only stronger than next opt-out", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "read-only");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();

    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "read-only private", timestamp: 1 }] },
      ctx,
    );

    expect(mocked.client.retain).not.toHaveBeenCalled();
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("normal");
  });

  it("honors session ignored mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "ignored");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    const recall = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "q", timestamp: 1 }] },
      ctx,
    );
    expect(recall).toBeUndefined();
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "remember", timestamp: 1 }] },
      ctx,
    );
    expect(mocked.client.retain).not.toHaveBeenCalled();
  });

  it("keeps ignored mode stronger than next opt-out", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "ignored");
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    const recall = await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "q", timestamp: 1 }] },
      ctx,
    );
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "ignored private", timestamp: 1 }] },
      ctx,
    );

    expect(recall).toBeUndefined();
    expect(mocked.client.retain).not.toHaveBeenCalled();
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("normal");
  });

  it("keeps retain off stronger than next opt-out", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionRetainEnabled(cwd, sessionFile, false);
    await setNextSessionRetainMode(cwd, sessionFile, "off");
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();

    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "retain off private", timestamp: 1 }] },
      ctx,
    );

    expect(mocked.client.retain).not.toHaveBeenCalled();
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("normal");
  });

  it("does not auto-retain when project bank is disabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        banks: { project: { enabled: false }, global: { enabled: true, bankId: "global-bank" } },
      }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "remember", timestamp: 1 }] },
      ctx,
    );

    expect(mocked.client.retain).not.toHaveBeenCalled();
  });

  it("does not emit retain status when retain is disabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ retain: { enabled: false } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    ctx.ui.setStatus.mockClear();

    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      ctx,
    );

    expect(mocked.client.retain).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("retains only new messages when agent_end receives overlapping transcripts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };
    const u1 = { role: "user", content: "u1", timestamp: 1 };
    const a1 = { role: "assistant", content: "a1", timestamp: 2 };
    const u2 = { role: "user", content: "u2", timestamp: 3 };
    const a2 = { role: "assistant", content: "a2", timestamp: 4 };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    mocked.client.retain.mockClear();
    await handlers.agent_end?.[0]?.({ messages: [u1, a1] }, ctx);
    await handlers.agent_end?.[0]?.({ messages: [u1, a1, u2, a2] }, ctx);

    const retainCalls = (mocked.client.retain.mock.calls as unknown[][]).filter(
      (call) => call[1] !== "Pi Hindsight append capability probe. Safe to ignore.",
    );
    expect(retainCalls).toHaveLength(2);
    const secondContent = retainCalls[1]?.[1] as string;
    expect(secondContent).toContain("u2");
    expect(secondContent).toContain("a2");
    expect(secondContent).not.toContain("u1");
    expect(secondContent).not.toContain("a1");
  });

  it("retains only new messages after lifecycle restart", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { baseUrl: "http://unused.test" } }),
    );
    const sessionFile = join(cwd, "session.jsonl");
    const u1 = { role: "user", content: "u1", timestamp: 1 };
    const a1 = { role: "assistant", content: "a1", timestamp: 2 };
    const u2 = { role: "user", content: "u2", timestamp: 3 };
    const a2 = { role: "assistant", content: "a2", timestamp: 4 };

    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    const first = createMemoryLifecycle(cwd);
    await first.initialize(ctx);
    mocked.client.retain.mockClear();
    await first.retain({ messages: [u1, a1] } as any, ctx);

    const second = createMemoryLifecycle(cwd);
    await second.initialize(ctx);
    await second.retain({ messages: [u1, a1, u2, a2] } as any, ctx);

    const retainCalls = (mocked.client.retain.mock.calls as unknown[][]).filter(
      (call) => call[1] !== "Pi Hindsight append capability probe. Safe to ignore.",
    );
    expect(retainCalls).toHaveLength(2);
    const secondContent = retainCalls[1]?.[1] as string;
    expect(secondContent).toContain("u2");
    expect(secondContent).toContain("a2");
    expect(secondContent).not.toContain("u1");
    expect(secondContent).not.toContain("a1");
  });

  it("keeps automatic retain payload stable when queued during outage", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        hindsight: { baseUrl: "http://unused.test" },
        notifications: { startup: false },
      }),
    );
    const sessionFile = join(cwd, "session-api_key=super-secret-token.jsonl");
    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };
    const lifecycle = createMemoryLifecycle(cwd);
    await lifecycle.initialize(ctx);
    mocked.client.retain.mockClear();
    mocked.client.retain.mockRejectedValue(new Error("offline TOKEN=queue-secret"));

    const result = await lifecycle.retain(
      {
        messages: [
          { role: "user", content: "Remember API_KEY=content-secret", timestamp: 1 },
          { role: "assistant", content: "Stored TOKEN=assistant-secret", timestamp: 2 },
        ],
      } as any,
      ctx,
    );

    expect(result).toMatchObject({ queued: true, sent: 0, remaining: 1 });
    const queued = await readRetainQueue(resolveQueuePath(cwd, ".pi/hindsight/retain-queue.jsonl"));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      bankId: expect.stringMatching(/^pi-project-/),
      documentId: liveDocumentId(sessionFile, cwd),
      updateMode: "append",
      retries: 1,
      lastError: "offline TOKEN=[REDACTED]",
      item: {
        context: expect.stringContaining("session-api_key=[REDACTED]"),
        async: true,
        metadata: {
          cwd,
          imported: "false",
          pi_session_file: expect.stringContaining("session-api_key=[REDACTED]"),
        },
        observationScopes: [["harness:pi"], [expect.stringMatching(/^repo:/)]],
      },
    });
    expect(queued[0]?.item.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        `session:${stableSessionId(sessionFile, cwd)}`,
        expect.stringMatching(/^repo:/),
      ]),
    );
    expect(queued[0]?.item.content).toContain("API_KEY=[REDACTED]");
    expect(queued[0]?.item.content).toContain("TOKEN=[REDACTED]");
    expect(JSON.stringify(queued[0])).not.toContain("content-secret");
    expect(JSON.stringify(queued[0])).not.toContain("assistant-secret");
    expect(JSON.stringify(queued[0])).not.toContain("super-secret");
    expect(JSON.stringify(queued[0])).not.toContain("queue-secret");
  });

  it("uses configured shutdown flush bounds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        retain: { shutdownFlushMaxJobs: 2, shutdownFlushTimeoutMs: 1_000 },
        notifications: { startup: false },
      }),
    );
    const queuePath = resolveQueuePath(cwd, ".pi/hindsight/retain-queue.jsonl");
    const baseJob: RetainJob = {
      id: "1",
      bankId: "project-bank",
      createdAt: "now",
      documentId: "doc",
      updateMode: "append",
      item: { content: "raw", context: "ctx", async: true, tags: ["source:pi"] },
      retries: 0,
    };
    await enqueueRetainJob(queuePath, { ...baseJob, id: "1" });
    await enqueueRetainJob(queuePath, { ...baseJob, id: "2" });
    await enqueueRetainJob(queuePath, { ...baseJob, id: "3" });

    const { createMemoryLifecycle } = await import("../extensions/lifecycle/memory-lifecycle.js");
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const lifecycle = createMemoryLifecycle(cwd);
    await lifecycle.initialize(ctx);
    mocked.client.retain.mockClear();
    await lifecycle.shutdown(ctx);

    expect(mocked.client.retain).toHaveBeenCalledTimes(2);
    expect((await readRetainQueue(queuePath)).map((job) => job.id)).toEqual(["3"]);
  });

  it("emits optional recall and retain notifications", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        banks: { global: { enabled: false } },
        notifications: { startup: false, recall: true, retain: true },
      }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.context?.[0]?.(
      { messages: [{ role: "user", content: "remember?", timestamp: 1 }] },
      ctx,
    );
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "assistant", content: "new decision", timestamp: 2 }] },
      ctx,
    );

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/^Hindsight recalled 1 memory item from pi-project-/),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/^Hindsight retained 1 new message to pi-project-/),
      "info",
    );
  });

  it("calls client.reflect after retain when postRetainReflect is enabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ retain: { postRetainReflect: true } }),
    );
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "assistant", content: "new decision", timestamp: 2 }] },
      ctx,
    );

    expect(mocked.client.reflect).toHaveBeenCalledWith(
      expect.stringMatching(/^pi-project-/),
      "Reflect on the recently retained session to extract insights",
      { context: "Post-retain reflection" },
    );
  });

  it("notifies (without failing retain) when postRetainReflect fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ retain: { postRetainReflect: true } }),
    );
    mocked.client.reflect.mockRejectedValueOnce(new Error("reflect unavailable"));
    const handlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>> = {};
    const pi = {
      on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<any>) => {
        handlers[name] = [...(handlers[name] ?? []), handler];
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    const ctx = {
      cwd,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") },
    };

    const { default: hindsightExtension } = await import("../extensions/index.js");
    hindsightExtension(pi as any);
    await handlers.session_start?.[0]?.({}, ctx);
    await handlers.agent_end?.[0]?.(
      { messages: [{ role: "assistant", content: "new decision", timestamp: 2 }] },
      ctx,
    );

    expect(mocked.client.retain).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/^Hindsight post-retain reflect failed: reflect unavailable$/),
      "warning",
    );
  });
});
