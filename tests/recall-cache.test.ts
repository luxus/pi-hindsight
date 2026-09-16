import { describe, expect, it } from "vitest";
import {
  createRecallCache,
  lastUserMessageContentIdentity,
  recallTurnCacheKey,
} from "../extensions/lifecycle/memory-lifecycle-recall.js";
import type { RecallBlock, RecallFailure } from "../extensions/types.js";

function makeEntry(rendered: string): {
  rendered: string;
  blocks: RecallBlock[];
  failed: number;
  failures: RecallFailure[];
  timestamp: number;
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
    timestamp: 1,
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

  it("reads TTL dynamically when given a getter", async () => {
    let ttl = 60_000;
    const cache = createRecallCache(() => ttl);
    const entry = makeEntry("dynamic");
    cache.set("key", entry);
    expect(cache.get("key")).toEqual(entry);
    ttl = 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cache.get("key")).toBeUndefined();
  });
});

describe("recallTurnCacheKey", () => {
  const nudge = { role: "user", content: "Please continue.", timestamp: 3_000 };

  it("keys on bank IDs plus last-user-message content, not message length", () => {
    const first = [{ role: "user", content: "Please continue.", timestamp: 1 }];
    const retry = [
      { role: "user", content: "fix the tests", timestamp: 1 },
      { role: "assistant", content: "provider error", timestamp: 2 },
      nudge,
    ];
    const laterRetry = [
      ...retry,
      { role: "assistant", content: "still failing", timestamp: 4 },
      { role: "user", content: "Please continue.", timestamp: 6_000 },
    ];

    expect(recallTurnCacheKey(["coding"], first)).toBe(recallTurnCacheKey(["coding"], retry));
    expect(recallTurnCacheKey(["coding"], retry)).toBe(recallTurnCacheKey(["coding"], laterRetry));
    expect(recallTurnCacheKey(["coding"], retry)).toBe("coding|Please continue.");
  });

  it("misses when the last user message content changes", () => {
    const original = [{ role: "user", content: "fix the tests", timestamp: 1 }];
    const next = [{ role: "user", content: "what about the queue?", timestamp: 2 }];
    expect(recallTurnCacheKey(["coding"], original)).not.toBe(recallTurnCacheKey(["coding"], next));
  });

  it("misses when bank IDs change", () => {
    const messages = [{ role: "user", content: "same question", timestamp: 1 }];
    expect(recallTurnCacheKey(["coding"], messages)).not.toBe(
      recallTurnCacheKey(["coding", "life"], messages),
    );
  });

  it("ignores last-user-message timestamp when forming identity", () => {
    expect(lastUserMessageContentIdentity([{ role: "user", content: "nudge", timestamp: 1 }])).toBe(
      lastUserMessageContentIdentity([{ role: "user", content: "nudge", timestamp: 9 }]),
    );
  });

  it("stringifies structured last-user content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "continue" }], timestamp: 1 },
    ];
    expect(lastUserMessageContentIdentity(messages)).toBe(
      JSON.stringify([{ type: "text", text: "continue" }]),
    );
  });
});
