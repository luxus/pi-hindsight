import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("queue lock acquisition", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("fails closed after deadline when lock mkdir keeps returning EPERM", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-lock-")), "q.jsonl");
    const lockPath = `${path}.lock`;
    let lockMkdirAttempts = 0;

    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      mkdir: async (target: string, options?: Parameters<typeof actualFs.mkdir>[1]) => {
        if (target === lockPath) {
          lockMkdirAttempts += 1;
          throw Object.assign(new Error("persistent lock permission failure"), { code: "EPERM" });
        }
        return actualFs.mkdir(target, options);
      },
    }));

    const { RETAIN_QUEUE_LOCK, withQueueLock } = await import("../extensions/queue-lock.js");
    const originalRetryMs = RETAIN_QUEUE_LOCK.retryMs;
    const originalTimeoutMs = RETAIN_QUEUE_LOCK.timeoutMs;
    RETAIN_QUEUE_LOCK.retryMs = 1;
    RETAIN_QUEUE_LOCK.timeoutMs = 5;
    try {
      await expect(withQueueLock(path, async () => "unexpected")).rejects.toThrow(
        /Timed out waiting for retain queue lock/,
      );
    } finally {
      RETAIN_QUEUE_LOCK.retryMs = originalRetryMs;
      RETAIN_QUEUE_LOCK.timeoutMs = originalTimeoutMs;
    }

    expect(lockMkdirAttempts).toBeGreaterThanOrEqual(1);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does not run stale cleanup after transient Windows mkdir EPERM contention", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-lock-")), "q.jsonl");
    const lockPath = `${path}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, "owner"),
      JSON.stringify({ pid: 123, acquiredAt: new Date().toISOString() }),
    );

    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      mkdir: async (target: string, options?: Parameters<typeof actualFs.mkdir>[1]) => {
        if (target === lockPath) {
          throw Object.assign(new Error("transient Windows lock contention"), { code: "EPERM" });
        }
        return actualFs.mkdir(target, options);
      },
    }));

    const { RETAIN_QUEUE_LOCK, withQueueLock } = await import("../extensions/queue-lock.js");
    const originalRetryMs = RETAIN_QUEUE_LOCK.retryMs;
    const originalTimeoutMs = RETAIN_QUEUE_LOCK.timeoutMs;
    RETAIN_QUEUE_LOCK.retryMs = 1;
    RETAIN_QUEUE_LOCK.timeoutMs = 5;
    try {
      await expect(withQueueLock(path, async () => "unexpected")).rejects.toThrow(
        /Timed out waiting for retain queue lock/,
      );
    } finally {
      RETAIN_QUEUE_LOCK.retryMs = originalRetryMs;
      RETAIN_QUEUE_LOCK.timeoutMs = originalTimeoutMs;
    }

    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(join(lockPath, "owner"))).toBe(true);
  });

  it("retries transient Windows mkdir EPERM errors at the lock-directory seam", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-lock-")), "q.jsonl");
    const lockPath = `${path}.lock`;
    let lockMkdirAttempts = 0;

    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      mkdir: async (target: string, options?: Parameters<typeof actualFs.mkdir>[1]) => {
        if (target === lockPath) {
          lockMkdirAttempts += 1;
          if (lockMkdirAttempts === 1) {
            throw Object.assign(new Error("transient Windows lock race"), { code: "EPERM" });
          }
        }
        return actualFs.mkdir(target, options);
      },
    }));

    const { RETAIN_QUEUE_LOCK, withQueueLock } = await import("../extensions/queue-lock.js");
    const originalRetryMs = RETAIN_QUEUE_LOCK.retryMs;
    const originalTimeoutMs = RETAIN_QUEUE_LOCK.timeoutMs;
    RETAIN_QUEUE_LOCK.retryMs = 1;
    RETAIN_QUEUE_LOCK.timeoutMs = 100;
    try {
      await withQueueLock(path, async () => "ok");
    } finally {
      RETAIN_QUEUE_LOCK.retryMs = originalRetryMs;
      RETAIN_QUEUE_LOCK.timeoutMs = originalTimeoutMs;
    }

    expect(lockMkdirAttempts).toBe(2);
    expect(existsSync(lockPath)).toBe(false);
  });
});
