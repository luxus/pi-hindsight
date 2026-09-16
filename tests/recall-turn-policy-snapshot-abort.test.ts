import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { RuntimeSnapshot } from "../extensions/lifecycle/memory-lifecycle-runtime.js";

vi.mock("../extensions/lifecycle/recall-visibility.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../extensions/lifecycle/recall-visibility.js")>();
  return {
    ...actual,
    writeLastRecallSnapshot: async () => {
      const error = new Error("hindsight last-recall snapshot aborted");
      error.name = "AbortError";
      throw error;
    },
  };
});

const { createRecallTurnPolicy } =
  await import("../extensions/lifecycle/memory-lifecycle-recall.js");

function runtimeFor(cwd: string): RuntimeSnapshot {
  mkdirSync(join(cwd, ".git"));
  return { cwd, ui: { setStatus: () => undefined, notify: () => undefined } };
}

describe("createRecallTurnPolicy snapshot abort", () => {
  it("does not inject when last-recall snapshot write is aborted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-snap-abort-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    const snapshotPath = join(cwd, ".pi", "hindsight", "last-recall.json");
    writeFileSync(
      snapshotPath,
      JSON.stringify({ query: "old", rendered: "previous", blocks: [], failed: 0 }),
    );
    const statuses: string[] = [];
    const policy = createRecallTurnPolicy({
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, storeLastRecall: true, storeLastRecallFailures: true },
      }),
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => ({ results: [{ text: "fresh memory" }] }),
        reflect: async () => ({}),
      }),
      setMemoryStatus: (_runtime, activity) => {
        statuses.push(activity);
      },
      notify: () => undefined,
    });

    const result = await policy.recall(
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as never,
      runtimeFor(cwd),
    );

    expect(result).toBeUndefined();
    expect(statuses.at(-1)).toBe("idle");
    expect(statuses).toContain("recalling");
    expect(JSON.parse(readFileSync(snapshotPath, "utf8")).query).toBe("old");
  });
});
