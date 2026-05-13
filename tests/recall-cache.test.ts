import { describe, expect, it, vi } from "vitest";
import { createRecallCache } from "../extensions/lifecycle/memory-lifecycle-recall.js";
import type { RecallBlock, RecallFailure } from "../extensions/types.js";

function makeEntry(rendered: string): {
  rendered: string;
  blocks: RecallBlock[];
  failed: number;
  failures: RecallFailure[];
} {
  return {
    rendered,
    blocks: [
      {
        bankId: "test-bank",
        query: "test",
        results: [],
        memoryCount: 1,
        rendered,
      } as RecallBlock,
    ],
    failed: 0,
    failures: [],
  };
}

describe("createRecallCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = createRecallCache(60000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns cached entry within TTL", () => {
    const cache = createRecallCache(60000);
    const entry = makeEntry("cached");
    cache.set("key", entry);
    expect(cache.get("key")).toEqual(entry);
  });

  it("stores different entries for different keys", () => {
    const cache = createRecallCache(60000);
    const entryA = makeEntry("a");
    const entryB = makeEntry("b");
    cache.set("key-a", entryA);
    cache.set("key-b", entryB);
    expect(cache.get("key-a")).toEqual(entryA);
    expect(cache.get("key-b")).toEqual(entryB);
  });

  it("expires entries after TTL", async () => {
    const cache = createRecallCache(1);
    const entry = makeEntry("expired");
    cache.set("key", entry);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cache.get("key")).toBeUndefined();
  });
});
