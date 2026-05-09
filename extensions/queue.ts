import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { HindsightLikeClient, RetainJob } from "./types.js";
import { deliverRetainJob, operationIdsFromResponse, redactQueueError } from "./queue-delivery.js";
import { JsonlQueueStore, type JsonlQueueFileSummary } from "./jsonl-queue-store.js";
import {
  RETAIN_QUEUE_LOCK,
  isQueueLockOwnerStale,
  type QueueLockOwner,
  withQueueLock,
} from "./queue-lock.js";

export { RETAIN_QUEUE_LOCK, isQueueLockOwnerStale, type QueueLockOwner } from "./queue-lock.js";

export function resolveQueuePath(cwd: string, queuePath: string): string {
  return isAbsolute(queuePath) ? queuePath : join(cwd, queuePath);
}

export function resolveDeadLetterQueuePath(path: string): string {
  return `${path}.dead.jsonl`;
}

export function resolveMalformedQueuePath(path: string): string {
  return `${path}.malformed.jsonl`;
}

export interface EnqueueRetainJobResult {
  previousLength: number;
  currentLength: number;
}

export async function enqueueRetainJobWithStats(
  path: string,
  job: RetainJob,
): Promise<EnqueueRetainJobResult> {
  return withQueueLock(path, async () => {
    const store = retainQueueStore(path);
    const previousLength = await store.count();
    await store.append([job]);
    return { previousLength, currentLength: previousLength + 1 };
  });
}

export async function enqueueRetainJob(path: string, job: RetainJob): Promise<void> {
  await enqueueRetainJobWithStats(path, job);
}

export async function readRetainQueue(path: string): Promise<RetainJob[]> {
  return retainQueueStore(path).readStrict();
}

export async function readDeadLetterQueue(path: string): Promise<RetainJob[]> {
  return readRetainQueue(resolveDeadLetterQueuePath(path));
}

export async function readRetainQueueTolerant(path: string) {
  return retainQueueStore(path).readTolerant();
}

export async function readDeadLetterQueueTolerant(path: string) {
  return readRetainQueueTolerant(resolveDeadLetterQueuePath(path));
}

export type RetainQueueFileSummary = JsonlQueueFileSummary;

export interface RetainQueueSummary {
  active: RetainQueueFileSummary;
  deadLetter: RetainQueueFileSummary;
}

export async function summarizeRetainQueue(path: string): Promise<RetainQueueSummary> {
  const [active, deadLetter] = await Promise.all([
    retainQueueStore(path).summarize(),
    retainQueueStore(resolveDeadLetterQueuePath(path)).summarize(),
  ]);
  return { active, deadLetter };
}

export async function writeRetainQueue(path: string, jobs: RetainJob[]): Promise<void> {
  await retainQueueStore(path).replace(jobs);
}

export async function removeRetainQueueJobs(
  path: string,
  predicate: (job: RetainJob) => boolean,
): Promise<number> {
  return withQueueLock(path, async () => {
    const parsed = await readRetainQueueTolerant(path);
    const remaining = parsed.jobs.filter((job) => !predicate(job));
    const removed = parsed.jobs.length - remaining.length;
    if (removed > 0) {
      await appendMalformedQueueLines(path, parsed.malformedLines);
      await writeRetainQueue(path, remaining);
    }
    return removed;
  });
}

async function appendDeadLetterJobs(path: string, jobs: RetainJob[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const deadLetterPath = resolveDeadLetterQueuePath(path);
  const existing = await readRetainQueueTolerant(deadLetterPath);
  const existingIds = new Set(existing.jobs.map((job) => job.id));
  const seen = new Set<string>();
  const newJobs = jobs.filter((job) => {
    if (existingIds.has(job.id) || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
  if (newJobs.length === 0) return 0;
  await retainQueueStore(deadLetterPath).append(newJobs);
  return newJobs.length;
}

export type FlushRetainQueueOptions = {
  maxRetries?: number;
  maxJobs?: number;
  stopOnFirstFailure?: boolean;
  maxElapsedMs?: number;
};

export interface FlushRetainQueueResult {
  sent: number;
  remaining: number;
  deadLettered: number;
  malformed: number;
  operationIds?: string[];
}

function isRetainJob(value: unknown): value is RetainJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const item = record.item as Record<string, unknown> | undefined;
  return (
    typeof record.id === "string" &&
    typeof record.bankId === "string" &&
    typeof record.documentId === "string" &&
    (record.updateMode === "append" || record.updateMode === "replace") &&
    typeof record.retries === "number" &&
    !!item &&
    typeof item === "object" &&
    typeof item.content === "string" &&
    typeof item.context === "string"
  );
}

function retainQueueStore(path: string): JsonlQueueStore<RetainJob> {
  return new JsonlQueueStore(path, isRetainJob);
}

async function appendMalformedQueueLines(path: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const malformedPath = resolveMalformedQueuePath(path);
  await mkdir(dirname(malformedPath), { recursive: true });
  const quarantinedAt = new Date().toISOString();
  await appendFile(
    malformedPath,
    lines
      .map((line) =>
        JSON.stringify({
          quarantinedAt,
          sourceQueue: path,
          line,
        }),
      )
      .join("\n") + "\n",
    "utf8",
  );
}

export async function flushRetainQueue(
  path: string,
  client: HindsightLikeClient,
  options: FlushRetainQueueOptions = {},
): Promise<FlushRetainQueueResult> {
  return withQueueLock(path, async () => {
    const resolvedOptions = options;
    const maxRetries = resolvedOptions.maxRetries ?? 5;
    const maxJobs = resolvedOptions.maxJobs ?? Number.POSITIVE_INFINITY;
    const maxElapsedMs = resolvedOptions.maxElapsedMs ?? Number.POSITIVE_INFINITY;
    const started = Date.now();
    const parsed = await readRetainQueueTolerant(path);
    const jobs = parsed.jobs;
    const remaining: RetainJob[] = [];
    const deadLetteredJobs: RetainJob[] = [];
    const operationIds: string[] = [];
    let sent = 0;
    for (const [index, job] of jobs.entries()) {
      if (index >= maxJobs || Date.now() - started >= maxElapsedMs) {
        remaining.push(...jobs.slice(index));
        break;
      }
      try {
        const response = await deliverRetainJob(client, job);
        operationIds.push(...operationIdsFromResponse(response));
        sent += 1;
      } catch (error) {
        const errorMessage = redactQueueError(error);
        const retries = job.retries + 1;
        const deadLetter = retries >= maxRetries;
        const failedJob = {
          ...job,
          retries,
          lastError: errorMessage,
          ...(deadLetter
            ? {
                deadLetteredAt: new Date().toISOString(),
                lastError: `${errorMessage}; retry limit reached, moved to dead-letter queue`,
              }
            : {}),
        };
        if (deadLetter) deadLetteredJobs.push(failedJob);
        else remaining.push(failedJob);
        if (resolvedOptions.stopOnFirstFailure) {
          remaining.push(...jobs.slice(index + 1));
          break;
        }
      }
    }
    await appendMalformedQueueLines(path, parsed.malformedLines);
    const appendedDeadLetterJobs = await appendDeadLetterJobs(path, deadLetteredJobs);
    await writeRetainQueue(path, remaining);
    return {
      sent,
      remaining: remaining.length,
      deadLettered: appendedDeadLetterJobs,
      malformed: parsed.malformedLines.length,
      ...(operationIds.length ? { operationIds: [...new Set(operationIds)] } : {}),
    };
  });
}
