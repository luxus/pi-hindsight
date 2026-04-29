import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueRetainJob, readRetainQueue, resolveQueuePath } from "../extensions/queue.js";
import {
  addSessionMemoryTag,
  readSessionMemoryMeta,
  setNextSessionRetainMode,
  setSessionMemoryMode,
} from "../extensions/session-memory-meta.js";
import type { RetainJob } from "../extensions/types.js";

const mocked = vi.hoisted(() => ({
  client: {
    retain: vi.fn(async (..._args: unknown[]) => undefined),
    recall: vi.fn(async (..._args: unknown[]) => ({
      results: [{ text: "repo-specific remembered fact" }],
    })),
    reflect: vi.fn(async (..._args: unknown[]) => ({})),
    createBank: vi.fn(async (..._args: unknown[]) => undefined),
    getBankProfile: vi.fn(async (..._args: unknown[]) => ({})),
  },
  ensureGlobalBank: vi.fn(async () => undefined),
  ensureProjectBank: vi.fn(async () => undefined),
  checkHindsight: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../extensions/client.js", () => ({
  createHindsightClient: () => mocked.client,
  checkHindsight: mocked.checkHindsight,
}));

vi.mock("../extensions/bank-operations.js", () => ({
  ensureGlobalBank: mocked.ensureGlobalBank,
  ensureProjectBank: mocked.ensureProjectBank,
}));

describe("extension hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.client.recall.mockImplementation(async (..._args: unknown[]) => ({
      results: [{ text: "repo-specific remembered fact" }],
    }));
    mocked.client.retain.mockImplementation(async (..._args: unknown[]) => undefined);
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
  });

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
      tags: [expect.stringMatching(/^repo:/)],
      tagsMatch: "any_strict",
    });
    expect(mocked.client.recall.mock.calls[1]?.[0]).toBe("global-bank");
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain(
      "Global memory lookup for durable user preferences",
    );
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain("scope:global");
    expect(mocked.client.recall.mock.calls[1]?.[1]).toContain("user: What do I know?");
    expect(mocked.client.recall.mock.calls[1]?.[2]).toMatchObject({
      tags: ["source:pi"],
      tagsMatch: "any_strict",
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

  it("probes append capability even if global bank ensure fails", async () => {
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

    expect(mocked.client.retain).toHaveBeenCalledWith(
      expect.stringMatching(/^pi-project-/),
      "Pi Hindsight append capability probe. Safe to ignore.",
      expect.objectContaining({ updateMode: "append" }),
    );
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

  it("honors session read-only mode and manual tags", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "read-only");
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

  it("does not reject when skipped-message cursor update fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-hooks-"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight", "retain-cursors.json"), "not json");
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
    expect(mocked.client.retain).toHaveBeenCalledWith(
      "global-bank",
      "Pi Hindsight append capability probe. Safe to ignore.",
      expect.objectContaining({ updateMode: "append" }),
    );
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

    const { createMemoryLifecycle } = await import("../extensions/memory-lifecycle.js");
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

    const { createMemoryLifecycle } = await import("../extensions/memory-lifecycle.js");
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
});
