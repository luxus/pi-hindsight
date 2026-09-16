import { randomUUID } from "node:crypto";
import { redactError, redactSecrets } from "../utils/sanitize.js";
import type { RecallResultItem } from "../types.js";

export interface RetrievalResultRef {
  id?: string;
  tags?: string[];
}

export interface RetrievalTelemetry {
  version: 1;
  phase: "retrieval" | "injection";
  mode: "automatic" | "explicit";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "success" | "empty" | "error" | "timeout" | "skipped";
  cache: "hit" | "miss" | "none";
  retrievalId?: string;
  contextId?: string;
  sessionId?: string;
  bankId?: string;
  kind?: "project" | "global";
  query?: string;
  tagGroups?: unknown[];
  rawIds?: string[];
  keptIds?: string[];
  injectedIds?: string[];
  rawCount?: number;
  keptCount?: number;
  injectedCount?: number;
  results?: RetrievalResultRef[];
  error?: string;
  renderedHash?: string;
  renderedLength?: number;
  injected?: boolean;
  retrievalIds?: string[];
  [key: string]: unknown;
}
export type RetrievalObserver = (event: RetrievalTelemetry) => void | Promise<void>;

function sanitizeTelemetry(event: RetrievalTelemetry): RetrievalTelemetry {
  const next: RetrievalTelemetry = { ...event };
  if (typeof next.query === "string") next.query = redactSecrets(next.query);
  if (Array.isArray(next.results)) {
    next.results = next.results.map((item) => {
      const { text: _text, ...rest } = item as RetrievalResultRef & { text?: string };
      return rest;
    });
  }
  return next;
}

// Never await exporters, expose mutable recall data, or allow observer failures
// (including rejected promises and payload projection failures) into memory policy.
export function emitRetrieval(
  observer: RetrievalObserver | undefined,
  build: () => RetrievalTelemetry,
): void {
  if (!observer) return;
  try {
    const pending = observer(sanitizeTelemetry(structuredClone(build())));
    if (pending) void Promise.resolve(pending).catch(() => {});
  } catch {
    /* telemetry is best effort */
  }
}
export function telemetryEvent(
  start: number,
  fields: Omit<RetrievalTelemetry, "version" | "startedAt" | "endedAt" | "durationMs">,
): RetrievalTelemetry {
  const end = Date.now();
  return {
    version: 1,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    durationMs: end - start,
    ...fields,
  } as RetrievalTelemetry;
}
export const retrievalId = () => randomUUID();
export function telemetryFailure(error: unknown): Pick<RetrievalTelemetry, "error" | "status"> {
  const message = redactError(error);
  return {
    error: message,
    status: /hindsight recall timed out after \d+ms/.test(message) ? "timeout" : "error",
  };
}
export function resultTelemetry(items: RecallResultItem[]) {
  return {
    rawCount: items.length,
    rawIds: resultIds(items),
    results: items.flatMap((item) => {
      const row: RetrievalResultRef = {
        ...(typeof item.id === "string" ? { id: item.id } : {}),
        ...(Array.isArray(item.tags) ? { tags: item.tags } : {}),
      };
      return Object.keys(row).length ? [row] : [];
    }),
  };
}
export function resultIds(items: RecallResultItem[]): string[] {
  return items.flatMap((item) => (typeof item.id === "string" ? [item.id] : []));
}
