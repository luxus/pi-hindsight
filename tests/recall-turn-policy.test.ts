import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecallTurnPolicy } from "../extensions/lifecycle/memory-lifecycle-recall.js";
import {
  readLastRecallSnapshot,
  writeLastRecallSnapshot,
} from "../extensions/lifecycle/recall-visibility.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";
import type { RuntimeSnapshot } from "../extensions/lifecycle/memory-lifecycle-runtime.js";

function runtimeFor(cwd: string): RuntimeSnapshot {
  mkdirSync(join(cwd, ".git"));
  return { cwd, ui: { setStatus: () => undefined, notify: () => undefined } };
}

describe("createRecallTurnPolicy unexpected failure", () => {
  it("writes a debug snapshot when storeLastRecall + storeLastRecallFailures are enabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const statuses: string[] = [];
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      recall: { ...DEFAULT_CONFIG.recall, storeLastRecall: true, storeLastRecallFailures: true },
    };

    const policy = createRecallTurnPolicy({
      getConfig: () => config,
      getClient: () => {
        throw new Error("client unavailable");
      },
      setMemoryStatus: (_runtime, activity) => {
        statuses.push(activity);
      },
      notify: () => undefined,
    });

    const result = await policy.recall(
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as never,
      runtime,
    );

    expect(result).toBeUndefined();
    expect(statuses).toEqual(["recalling", "recall-failed"]);
    const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
    expect(snapshot?.failed).toBe(1);
    expect(snapshot?.failures?.[0]?.error).toContain("client unavailable");
  });

  it("does not write a snapshot when storeLastRecallFailures is disabled (default)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const config: ResolvedConfig = DEFAULT_CONFIG;

    const policy = createRecallTurnPolicy({
      getConfig: () => config,
      getClient: () => {
        throw new Error("client unavailable");
      },
      setMemoryStatus: () => undefined,
      notify: () => undefined,
    });

    await policy.recall(
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as never,
      runtime,
    );

    const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
    expect(snapshot).toBeUndefined();
  });

  it("treats abort as idle cancel without inject or sidecar", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const statuses: string[] = [];
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      recall: { ...DEFAULT_CONFIG.recall, storeLastRecall: true, storeLastRecallFailures: true },
    };
    await writeLastRecallSnapshot(cwd, config.recall.lastRecallPath, {
      query: "keep-me",
      rendered: "previous",
      blocks: [],
      failed: 0,
    });
    const controller = new AbortController();
    let recallStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      recallStarted = resolve;
    });
    const policy = createRecallTurnPolicy({
      getConfig: () => config,
      getClient: () => ({
        retain: async () => undefined,
        recall: async (_bankId, _query, options) => {
          recallStarted();
          const signal = options && typeof options === "object" ? options.signal : undefined;
          return new Promise((_, reject) => {
            const fail = () => {
              const error = new Error("hindsight recall aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (signal?.aborted) {
              fail();
              return;
            }
            signal?.addEventListener("abort", fail, { once: true });
          });
        },
        reflect: async () => ({}),
      }),
      setMemoryStatus: (_runtime, activity) => {
        statuses.push(activity);
      },
      notify: () => undefined,
    });

    const pending = policy.recall(
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as never,
      { ...runtime, signal: controller.signal },
    );
    await started;
    controller.abort();
    const result = await pending;

    expect(result).toBeUndefined();
    expect(statuses).toEqual(["recalling", "idle"]);
    const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
    expect(snapshot?.query).toBe("keep-me");
    expect(snapshot?.rendered).toBe("previous");
  });

  it("resets to idle without recalling when the turn is already aborted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const statuses: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const recall = vi.fn(async () => ({ results: [{ text: "should not run" }] }));
    const policy = createRecallTurnPolicy({
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, storeLastRecall: true, storeLastRecallFailures: true },
      }),
      getClient: () => ({
        retain: async () => undefined,
        recall,
        reflect: async () => ({}),
      }),
      setMemoryStatus: (_runtime, activity) => {
        statuses.push(activity);
      },
      notify: () => undefined,
    });

    const result = await policy.recall(
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as never,
      { ...runtime, signal: controller.signal },
    );

    expect(result).toBeUndefined();
    expect(recall).not.toHaveBeenCalled();
    expect(statuses).toEqual(["idle"]);
    expect(await readLastRecallSnapshot(cwd, DEFAULT_CONFIG.recall.lastRecallPath)).toBeUndefined();
  });
});

function mockRecallClient(
  recall = vi.fn(async () => ({ results: [{ text: "remembered fact" }] })),
): HindsightLikeClient & { recall: ReturnType<typeof vi.fn> } {
  return {
    retain: vi.fn(async () => undefined),
    recall,
    reflect: vi.fn(async () => ({})),
  };
}

function injectedRecall(
  patch: { messages: Array<{ content?: unknown; timestamp?: number }> } | undefined,
) {
  return patch?.messages.find((message) => String(message.content).includes("<hindsight-memory>"));
}

function policyFor(client: HindsightLikeClient, config: ResolvedConfig = DEFAULT_CONFIG) {
  const statuses: string[] = [];
  const policy = createRecallTurnPolicy({
    getConfig: () => config,
    getClient: () => client,
    setMemoryStatus: (_runtime, activity) => {
      statuses.push(activity);
    },
    notify: () => undefined,
  });
  return { policy, statuses };
}

describe("createRecallTurnPolicy cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses recall and first-seen timestamp on auto-continue identical nudges", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const client = mockRecallClient();
    const { policy, statuses } = policyFor(client);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const first = await policy.recall(
      { messages: [{ role: "user", content: "Please continue.", timestamp: 1 }] } as never,
      runtime,
    );
    now = 4_000;
    const retry = await policy.recall(
      {
        messages: [
          { role: "user", content: "fix the tests", timestamp: 1 },
          { role: "assistant", content: "provider error", timestamp: 2 },
          { role: "user", content: "Please continue.", timestamp: 3_000 },
        ],
      } as never,
      runtime,
    );

    expect(client.recall).toHaveBeenCalledTimes(1);
    const firstInjected = injectedRecall(first);
    const retryInjected = injectedRecall(retry);
    expect(firstInjected?.content).toBe(retryInjected?.content);
    expect(firstInjected?.timestamp).toBe(1_000);
    expect(retryInjected?.timestamp).toBe(1_000);
    expect(statuses.filter((status) => status === "recalling")).toHaveLength(1);
    expect(statuses.filter((status) => status === "recalled")).toHaveLength(2);
  });

  it("misses when last user input changes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const client = mockRecallClient();
    const { policy } = policyFor(client);

    await policy.recall(
      { messages: [{ role: "user", content: "fix the tests", timestamp: 1 }] } as never,
      runtime,
    );
    await policy.recall(
      { messages: [{ role: "user", content: "what about the queue?", timestamp: 2 }] } as never,
      runtime,
    );

    expect(client.recall).toHaveBeenCalledTimes(2);
  });

  it("misses after TTL expiry even when last user content is unchanged", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-turn-"));
    const runtime = runtimeFor(cwd);
    const client = mockRecallClient();
    const { policy } = policyFor(client, {
      ...DEFAULT_CONFIG,
      recall: { ...DEFAULT_CONFIG.recall, cacheTtlMs: 50 },
    });
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const first = await policy.recall(
      { messages: [{ role: "user", content: "Please continue.", timestamp: 1 }] } as never,
      runtime,
    );
    now = 1_060;
    const expired = await policy.recall(
      {
        messages: [
          { role: "user", content: "fix the tests", timestamp: 1 },
          { role: "user", content: "Please continue.", timestamp: 2 },
        ],
      } as never,
      runtime,
    );

    expect(client.recall).toHaveBeenCalledTimes(2);
    expect(injectedRecall(first)?.timestamp).toBe(1_000);
    expect(injectedRecall(expired)?.timestamp).toBe(1_060);
  });
});
