import { describe, expect, it } from "vitest";
import {
  formatFlushRetainQueueResult,
  flushRetainQueueNotifyLevel,
} from "../extensions/queue/flush-presenter.js";

describe("flush presenter", () => {
  it("returns info for clean flush", () => {
    const result = { sent: 3, remaining: 0, deadLettered: 0, malformed: 0 };
    expect(flushRetainQueueNotifyLevel(result)).toBe("info");
    expect(formatFlushRetainQueueResult(result)).toContain("3");
  });

  it("returns warning when jobs remain", () => {
    const result = { sent: 1, remaining: 2, deadLettered: 0, malformed: 0 };
    expect(flushRetainQueueNotifyLevel(result)).toBe("warning");
    expect(formatFlushRetainQueueResult(result)).toContain("remaining");
  });

  it("returns warning when jobs dead-lettered", () => {
    const result = { sent: 1, remaining: 0, deadLettered: 2, malformed: 0 };
    expect(flushRetainQueueNotifyLevel(result)).toBe("warning");
    expect(formatFlushRetainQueueResult(result)).toContain("dead-lettered");
  });

  it("returns info when jobs malformed only", () => {
    const result = { sent: 1, remaining: 0, deadLettered: 0, malformed: 3 };
    expect(flushRetainQueueNotifyLevel(result)).toBe("info");
    expect(formatFlushRetainQueueResult(result)).toContain("flushed 1");
  });
});
