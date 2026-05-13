import type { FlushRetainQueueResult } from "./queue.js";

export function formatFlushRetainQueueResult(result: FlushRetainQueueResult): string {
  return `Hindsight flushed ${result.sent}; dead-lettered ${result.deadLettered}; remaining ${result.remaining}`;
}

export function flushRetainQueueNotifyLevel(result: FlushRetainQueueResult): "info" | "warning" {
  return result.remaining || result.deadLettered || result.malformed ? "warning" : "info";
}
