import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
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

export function isQueueLockRaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "EPERM" || code === "ENOTEMPTY" || code === "EBUSY";
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
      const code = (error as NodeJS.ErrnoException).code;
      if (!isQueueLockRaceError(error)) throw error;
      if (code === "EEXIST" && (await removeLockIfStillStale(lockPath))) continue;
      if (Date.now() - started > RETAIN_QUEUE_LOCK.timeoutMs)
        throw new Error(`Timed out waiting for retain queue lock ${lockPath}`);
      await sleep(RETAIN_QUEUE_LOCK.retryMs);
    }
  }
}

export async function withQueueLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const previous = queueLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = previous.catch(() => undefined).then(() => next);
  queueLocks.set(path, lock);
  await previous.catch(() => undefined);
  let releaseFileLock: (() => Promise<void>) | undefined;
  try {
    releaseFileLock = await acquireFileLock(path);
    return await fn();
  } finally {
    try {
      if (releaseFileLock) await releaseFileLock();
    } finally {
      release();
      if (queueLocks.get(path) === lock) queueLocks.delete(path);
    }
  }
}
