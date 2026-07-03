import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecallTurnPolicy } from "../extensions/lifecycle/memory-lifecycle-recall.js";
import { readLastRecallSnapshot } from "../extensions/lifecycle/recall-visibility.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { ResolvedConfig } from "../extensions/types.js";
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
});
