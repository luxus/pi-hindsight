import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  HindsightLikeClient,
  ResolvedConfig,
  RetainJob,
  RetainOutcome,
  UpdateMode,
} from "../types.js";
import { deliverRetainJob, parseRetainOutcome, redactQueueError } from "./queue-delivery.js";
import { JsonlQueueStore, type JsonlQueueFileSummary } from "./jsonl-queue-store.js";
import { runRetainBeforeEnqueueCheck } from "./retain-before-enqueue.js";
import { withQueueLock } from "./queue-lock.js";

export { RETAIN_QUEUE_LOCK, isQueueLockOwnerStale, type QueueLockOwner } from "./queue-lock.js";

export function resolveQueuePath(cwd: string, queuePath: string): string {
  return isAbsolute(queuePath) ? queuePath : join(cwd, queuePath);
}

export function retainQueuePath(cwd: string, config: ResolvedConfig): string {
  return resolveQueuePath(cwd, config.retain.queuePath);
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

// Two automatic-retain jobs can be merged into one remote operation when they target the
// same bank + document with append semantics and carry no delivery failures yet. Merging
// concatenates their (cursor-filtered) deltas so a single delivery covers both, which is
// what cuts server extraction/consolidation and Postgres write amplification.
export function canCoalesceRetainJobs(existing: RetainJob, incoming: RetainJob): boolean {
  return (
    existing.bankId === incoming.bankId &&
    existing.documentId === incoming.documentId &&
    existing.updateMode === "append" &&
    incoming.updateMode === "append" &&
    existing.retries === 0 &&
    existing.deadLetteredAt === undefined
  );
}

function mergeRetainContent(existing: string, incoming: string): string {
  // Automatic-retain content is a JSON array of projected messages. When both sides parse
  // as arrays, concatenate the elements so the merged job is indistinguishable from having
  // enqueued the deltas sequentially. Fall back to newline concatenation otherwise.
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(incoming);
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a, ...b], null, 2);
  } catch {
    // fall through to string concatenation
  }
  return `${existing}\n${incoming}`;
}

export function coalesceRetainJob(existing: RetainJob, incoming: RetainJob): RetainJob {
  const tags = [...new Set([...(existing.item.tags ?? []), ...(incoming.item.tags ?? [])])];
  return {
    ...existing,
    item: {
      ...existing.item,
      ...incoming.item,
      content: mergeRetainContent(existing.item.content, incoming.item.content),
      ...(tags.length ? { tags } : {}),
    },
  };
}

// Append the job, or merge into the last queue entry only when compatible.
// Only the tail is considered so append order never jumps past a failed/non-mergeable job.
export async function enqueueRetainJobCoalesced(
  path: string,
  job: RetainJob,
  beforeAdmit?: (candidate: RetainJob) => Promise<void>,
): Promise<{ coalesced: boolean; currentLength: number }> {
  return withQueueLock(path, async () => {
    const store = retainQueueStore(path);
    const parsed = await store.readTolerant();
    const jobs = parsed.jobs;
    const last = jobs[jobs.length - 1];
    if (last && canCoalesceRetainJobs(last, job)) {
      const candidate = coalesceRetainJob(last, job);
      await beforeAdmit?.(candidate);
      jobs[jobs.length - 1] = candidate;
      await appendMalformedQueueLines(path, parsed.malformedLines);
      await store.replace(jobs);
      return { coalesced: true, currentLength: jobs.length };
    }
    await beforeAdmit?.(job);
    await store.append([job]);
    return { coalesced: false, currentLength: jobs.length + 1 };
  });
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

export interface RetainDeliverySummary {
  queueJobId: string;
  bankId: string;
  documentId: string;
  updateMode: UpdateMode;
  context: string;
  tags: string[];
  outcome: RetainOutcome;
}

export interface FlushRetainQueueResult {
  sent: number;
  remaining: number;
  deadLettered: number;
  malformed: number;
  operationIds?: string[];
  outcome?: RetainOutcome;
  delivered?: RetainDeliverySummary[];
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
    const delivered: RetainDeliverySummary[] = [];
    let itemsCount = 0;
    let hasItemsCount = false;
    let tokens = 0;
    let hasTokens = false;
    let sent = 0;
    for (const [index, job] of jobs.entries()) {
      if (index >= maxJobs || Date.now() - started >= maxElapsedMs) {
        remaining.push(...jobs.slice(index));
        break;
      }
      try {
        const response = await deliverRetainJob(client, job);
        const outcome = parseRetainOutcome(response);
        operationIds.push(...outcome.operationIds);
        if (outcome.itemsCount !== undefined) {
          itemsCount += outcome.itemsCount;
          hasItemsCount = true;
        }
        if (outcome.tokens !== undefined) {
          tokens += outcome.tokens;
          hasTokens = true;
        }
        const jobOutcome: RetainOutcome = {
          ...(outcome.itemsCount !== undefined ? { itemsCount: outcome.itemsCount } : {}),
          ...(outcome.operationIds.length ? { operations: outcome.operationIds.length } : {}),
          ...(outcome.tokens !== undefined ? { tokens: outcome.tokens } : {}),
        };
        delivered.push({
          queueJobId: job.id,
          bankId: job.bankId,
          documentId: job.documentId,
          updateMode: job.updateMode,
          context: job.item.context,
          tags: job.item.tags ?? [],
          outcome: jobOutcome,
        });
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
    const uniqueOperationIds = [...new Set(operationIds)];
    const aggregate: RetainOutcome = {
      ...(hasItemsCount ? { itemsCount } : {}),
      ...(uniqueOperationIds.length ? { operations: uniqueOperationIds.length } : {}),
      ...(hasTokens ? { tokens } : {}),
    };
    return {
      sent,
      remaining: remaining.length,
      deadLettered: appendedDeadLetterJobs,
      malformed: parsed.malformedLines.length,
      ...(uniqueOperationIds.length ? { operationIds: uniqueOperationIds } : {}),
      ...(hasItemsCount || uniqueOperationIds.length || hasTokens ? { outcome: aggregate } : {}),
      ...(delivered.length ? { delivered } : {}),
    };
  });
}

export async function enqueueRetain(
  cwd: string,
  config: ResolvedConfig,
  job: RetainJob,
): Promise<EnqueueRetainJobResult> {
  await runRetainBeforeEnqueueCheck(config, job);
  return enqueueRetainJobWithStats(retainQueuePath(cwd, config), job);
}

export async function enqueueRetainCoalesced(
  cwd: string,
  config: ResolvedConfig,
  job: RetainJob,
): Promise<{ coalesced: boolean; currentLength: number }> {
  return enqueueRetainJobCoalesced(retainQueuePath(cwd, config), job, (candidate) =>
    runRetainBeforeEnqueueCheck(config, candidate),
  );
}

export async function flushRetain(
  cwd: string,
  config: ResolvedConfig,
  client: HindsightLikeClient,
  options?: FlushRetainQueueOptions,
): Promise<FlushRetainQueueResult> {
  return flushRetainQueue(retainQueuePath(cwd, config), client, options);
}

export async function readQueuedRetains(cwd: string, config: ResolvedConfig): Promise<RetainJob[]> {
  return readRetainQueue(retainQueuePath(cwd, config));
}

export async function removeQueuedRetains(
  cwd: string,
  config: ResolvedConfig,
  predicate: (job: RetainJob) => boolean,
): Promise<number> {
  return removeRetainQueueJobs(retainQueuePath(cwd, config), predicate);
}

export async function summarizeRetain(
  cwd: string,
  config: ResolvedConfig,
): Promise<RetainQueueSummary> {
  return summarizeRetainQueue(retainQueuePath(cwd, config));
}
