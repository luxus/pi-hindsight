import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { HindsightLikeClient, RetainJob } from "./types.js";

const queueLocks = new Map<string, Promise<void>>();

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

export const RETAIN_QUEUE_LOCK = {
  retryMs: LOCK_RETRY_MS,
  timeoutMs: LOCK_TIMEOUT_MS,
  staleMs: LOCK_STALE_MS,
};

export interface QueueLockOwner {
  pid?: number;
  acquiredAt?: string;
  token?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
}

async function writeQueueHeartbeat(lockPath: string, token: string): Promise<void> {
  const heartbeatPath = `${lockPath}/heartbeat-${token}`;
  const tmpPath = `${heartbeatPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, new Date().toISOString(), "utf8");
  await rename(tmpPath, heartbeatPath);
}

async function writeQueueLockOwner(lockPath: string, token: string): Promise<void> {
  const ownerPath = `${lockPath}/owner`;
  const tmpPath = `${ownerPath}.${process.pid}.${token}.tmp`;
  await writeFile(
    tmpPath,
    JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), token }),
    "utf8",
  );
  await rename(tmpPath, ownerPath);
  await writeQueueHeartbeat(lockPath, token);
}

function startQueueLockHeartbeat(lockPath: string, token: string): NodeJS.Timeout {
  const heartbeatMs = Math.max(1, Math.min(5_000, Math.floor(RETAIN_QUEUE_LOCK.staleMs / 2)));
  const heartbeat = setInterval(() => {
    void writeQueueHeartbeat(lockPath, token).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref?.();
  return heartbeat;
}

export function isQueueLockOwnerStale(
  owner: QueueLockOwner | undefined,
  now = Date.now(),
  staleMs = RETAIN_QUEUE_LOCK.staleMs,
): boolean {
  if (!owner) return true;
  const acquiredAt = owner.acquiredAt ? Date.parse(owner.acquiredAt) : Number.NaN;
  return !Number.isFinite(acquiredAt) || now - acquiredAt > staleMs;
}

async function readQueueLockOwner(lockPath: string): Promise<QueueLockOwner | undefined> {
  try {
    return JSON.parse(await readFile(`${lockPath}/owner`, "utf8")) as QueueLockOwner;
  } catch {
    return undefined;
  }
}

async function isOwnerlessLockDirectoryStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > RETAIN_QUEUE_LOCK.staleMs;
  } catch {
    return true;
  }
}

async function isQueueLockStale(lockPath: string, owner: QueueLockOwner): Promise<boolean> {
  if (!owner.token) return isQueueLockOwnerStale(owner);
  try {
    const heartbeat = await stat(`${lockPath}/heartbeat-${owner.token}`);
    return Date.now() - heartbeat.mtimeMs > RETAIN_QUEUE_LOCK.staleMs;
  } catch {
    return isQueueLockOwnerStale(owner);
  }
}

async function removeLockIfOwned(lockPath: string, token: string): Promise<void> {
  const owner = await readQueueLockOwner(lockPath);
  if (owner?.token === token) await removeDirectory(lockPath);
}

function staleClaimPath(lockPath: string): string {
  return `${lockPath}.stale-claim`;
}

async function isStaleCleanupClaimActive(lockPath: string): Promise<boolean> {
  const claimPath = staleClaimPath(lockPath);
  try {
    const info = await stat(claimPath);
    if (Date.now() - info.mtimeMs <= RETAIN_QUEUE_LOCK.staleMs) return true;
    await removeDirectory(claimPath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function withStaleCleanupClaim<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const claimPath = staleClaimPath(lockPath);
  try {
    await mkdir(claimPath, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    return await fn();
  } finally {
    await removeDirectory(claimPath);
  }
}

async function removeLockIfStillStale(lockPath: string): Promise<boolean> {
  return (
    (await withStaleCleanupClaim(lockPath, async () => {
      const owner = await readQueueLockOwner(lockPath);
      const stale = owner
        ? await isQueueLockStale(lockPath, owner)
        : await isOwnerlessLockDirectoryStale(lockPath);
      if (!stale) return false;
      await removeDirectory(lockPath);
      return true;
    })) ?? false
  );
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const started = Date.now();
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    if (await isStaleCleanupClaimActive(lockPath)) {
      if (Date.now() - started > RETAIN_QUEUE_LOCK.timeoutMs)
        throw new Error(`Timed out waiting for retain queue lock ${lockPath}`);
      await sleep(RETAIN_QUEUE_LOCK.retryMs);
      continue;
    }
    const token = randomUUID();
    try {
      await mkdir(lockPath, { recursive: false });
      try {
        await writeQueueLockOwner(lockPath, token);
      } catch (error) {
        await removeDirectory(lockPath);
        if (["ENOENT", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
      const heartbeat = startQueueLockHeartbeat(lockPath, token);
      return async () => {
        clearInterval(heartbeat);
        await removeLockIfOwned(lockPath, token);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await removeLockIfStillStale(lockPath)) continue;
      if (Date.now() - started > RETAIN_QUEUE_LOCK.timeoutMs)
        throw new Error(`Timed out waiting for retain queue lock ${lockPath}`);
      await sleep(RETAIN_QUEUE_LOCK.retryMs);
    }
  }
}

async function withQueueLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const previous = queueLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = previous.catch(() => undefined).then(() => next);
  queueLocks.set(path, lock);
  await previous.catch(() => undefined);
  const releaseFileLock = await acquireFileLock(path);
  try {
    return await fn();
  } finally {
    try {
      await releaseFileLock();
    } finally {
      release();
      if (queueLocks.get(path) === lock) queueLocks.delete(path);
    }
  }
}

export function resolveQueuePath(cwd: string, queuePath: string): string {
  return isAbsolute(queuePath) ? queuePath : join(cwd, queuePath);
}

export function resolveDeadLetterQueuePath(path: string): string {
  return `${path}.dead.jsonl`;
}

export interface EnqueueRetainJobResult {
  previousLength: number;
  currentLength: number;
}

async function countQueuedLines(path: string): Promise<number> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter(Boolean).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function enqueueRetainJobWithStats(
  path: string,
  job: RetainJob,
): Promise<EnqueueRetainJobResult> {
  return withQueueLock(path, async () => {
    const previousLength = await countQueuedLines(path);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(job)}\n`, "utf8");
    return { previousLength, currentLength: previousLength + 1 };
  });
}

export async function enqueueRetainJob(path: string, job: RetainJob): Promise<void> {
  await enqueueRetainJobWithStats(path, job);
}

export async function readRetainQueue(path: string): Promise<RetainJob[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RetainJob);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readDeadLetterQueue(path: string): Promise<RetainJob[]> {
  return readRetainQueue(resolveDeadLetterQueuePath(path));
}

export interface RetainQueueFileSummary {
  path: string;
  valid: number;
  malformed: number;
  error: string | null;
}

export interface RetainQueueSummary {
  active: RetainQueueFileSummary;
  deadLetter: RetainQueueFileSummary;
}

async function summarizeQueueFile(path: string): Promise<RetainQueueFileSummary> {
  try {
    const text = await readFile(path, "utf8");
    let valid = 0;
    let malformed = 0;
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        JSON.parse(line) as RetainJob;
        valid += 1;
      } catch {
        malformed += 1;
      }
    }
    return { path, valid, malformed, error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, valid: 0, malformed: 0, error: null };
    }
    return {
      path,
      valid: 0,
      malformed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function summarizeRetainQueue(path: string): Promise<RetainQueueSummary> {
  const [active, deadLetter] = await Promise.all([
    summarizeQueueFile(path),
    summarizeQueueFile(resolveDeadLetterQueuePath(path)),
  ]);
  return { active, deadLetter };
}

export async function writeRetainQueue(path: string, jobs: RetainJob[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    jobs.map((job) => JSON.stringify(job)).join("\n") + (jobs.length ? "\n" : ""),
    "utf8",
  );
  await rename(tmp, path);
}

async function appendDeadLetterJobs(path: string, jobs: RetainJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const deadLetterPath = resolveDeadLetterQueuePath(path);
  await mkdir(dirname(deadLetterPath), { recursive: true });
  await appendFile(
    deadLetterPath,
    jobs.map((job) => JSON.stringify(job)).join("\n") + "\n",
    "utf8",
  );
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
    const jobs = await readRetainQueue(path);
    const remaining: RetainJob[] = [];
    const deadLetteredJobs: RetainJob[] = [];
    let sent = 0;
    for (const [index, job] of jobs.entries()) {
      if (index >= maxJobs || Date.now() - started >= maxElapsedMs) {
        remaining.push(...jobs.slice(index));
        break;
      }
      try {
        const options = {
          context: job.item.context,
          ...(job.item.timestamp ? { timestamp: job.item.timestamp } : {}),
          ...(job.item.metadata ? { metadata: job.item.metadata } : {}),
          ...(job.item.async !== undefined ? { async: job.item.async } : {}),
          ...(job.item.tags ? { tags: job.item.tags } : {}),
          ...(job.item.observationScopes ? { observationScopes: job.item.observationScopes } : {}),
          documentId: job.documentId,
          updateMode: job.updateMode,
        };
        await client.retain(job.bankId, job.item.content, options);
        sent += 1;
      } catch (error) {
        const retries = job.retries + 1;
        const deadLetter = retries >= maxRetries;
        const failedJob = {
          ...job,
          retries,
          lastError: error instanceof Error ? error.message : String(error),
          ...(deadLetter
            ? {
                deadLetteredAt: new Date().toISOString(),
                lastError: `${error instanceof Error ? error.message : String(error)}; retry limit reached, moved to dead-letter queue`,
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
    await appendDeadLetterJobs(path, deadLetteredJobs);
    await writeRetainQueue(path, remaining);
    return { sent, remaining: remaining.length, deadLettered: deadLetteredJobs.length };
  });
}
