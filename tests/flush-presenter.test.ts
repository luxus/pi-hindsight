import { describe, expect, it } from "vitest";
import {
  flushRetainQueueNotifyLevel,
  formatFlushRetainQueueResult,
} from "../extensions/flush-presenter.js";
import type { FlushRetainQueueResult } from "../extensions/queue.js";

function result(overrides: Partial<FlushRetainQueueResult> = {}): FlushRetainQueueResult {
  return { sent: 1, remaining: 0, deadLettered: 0, malformed: 0, ...overrides };
}

describe("flush presenter", () => {
  it("formats retain queue flush results", () => {
    expect(formatFlushRetainQueueResult(result({ sent: 2, deadLettered: 1, remaining: 3 }))).toBe(
      "Hindsight flushed 2; dead-lettered 1; remaining 3",
    );
  });

  it("warns when a flush leaves queued or dead-lettered jobs", () => {
    expect(flushRetainQueueNotifyLevel(result())).toBe("info");
    expect(flushRetainQueueNotifyLevel(result({ remaining: 1 }))).toBe("warning");
    expect(flushRetainQueueNotifyLevel(result({ deadLettered: 1 }))).toBe("warning");
  });
});
