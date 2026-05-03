import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  enqueueRetainJob,
  flushRetainQueue,
  isQueueLockOwnerStale,
  readDeadLetterQueue,
  readRetainQueue,
  RETAIN_QUEUE_LOCK,
  resolveDeadLetterQueuePath,
  resolveMalformedQueuePath,
  resolveQueuePath,
  summarizeRetainQueue,
  writeRetainQueue,
} from "../extensions/queue.js";
import { retainOptionsForJob } from "../extensions/queue-delivery.js";
import type { RetainJob } from "../extensions/types.js";

const job: RetainJob = {
  id: "1",
  bankId: "b",
  createdAt: "now",
  documentId: "doc",
  updateMode: "append",
  item: { content: "raw", context: "ctx", async: true, tags: ["source:pi"] },
  retries: 0,
};

const require = createRequire(import.meta.url);
const viteNodeBin = require.resolve("vite-node/vite-node.mjs");

function runWorker(mode: string, path: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [viteNodeBin, "tests/fixtures/queue-worker.mjs", mode, path, id],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`queue worker exited ${code}: ${stderr}`));
    });
  });
}

const stressCases = [0, 1, 2, 3, 4];

async function createQueueWithJob(id = "1"): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
  await enqueueRetainJob(path, { ...job, id });
  return path;
}

describe("retain queue", () => {
  it("checks stale locks from owner acquiredAt instead of waiter age", () => {
    const now = Date.parse("2026-04-27T12:00:00.000Z");
    expect(
      isQueueLockOwnerStale({ pid: 123, acquiredAt: "2026-04-27T11:59:59.000Z" }, now, 2_000),
    ).toBe(false);
    expect(
      isQueueLockOwnerStale({ pid: 123, acquiredAt: "2026-04-27T11:59:57.000Z" }, now, 2_000),
    ).toBe(true);
    expect(isQueueLockOwnerStale(undefined, now, 2_000)).toBe(true);
    expect(isQueueLockOwnerStale({ pid: 123, acquiredAt: "not-a-date" }, now, 2_000)).toBe(true);
  });

  it("maps retain jobs to Hindsight retain options", () => {
    expect(
      retainOptionsForJob({
        ...job,
        item: {
          ...job.item,
          timestamp: "2026-01-01T00:00:00.000Z",
          metadata: { source: "test" },
          entities: [{ text: "entity", type: "thing" }],
          observationScopes: [["repo:abc"]],
        },
      }),
    ).toMatchObject({
      context: "ctx",
      timestamp: "2026-01-01T00:00:00.000Z",
      metadata: { source: "test" },
      async: true,
      entities: [{ text: "entity", type: "thing" }],
      tags: ["source:pi"],
      observationScopes: [["repo:abc"]],
      documentId: "doc",
      updateMode: "append",
    });
  });

  it("persists and flushes jobs", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    expect(await readRetainQueue(path)).toHaveLength(1);
    const calls: unknown[] = [];
    const result = await flushRetainQueue(path, {
      retain: async (...args: unknown[]) => {
        calls.push(args);
      },
      recall: async () => [],
      reflect: async () => ({}),
    });
    expect(result.sent).toBe(1);
    expect(await readRetainQueue(path)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(["b", "raw", { async: true }]);
  });

  it("appends jobs even when earlier queue lines are malformed", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    writeFileSync(path, "{not json}\n", "utf8");

    await enqueueRetainJob(path, job);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"id":"1"');
    await expect(readRetainQueue(path)).rejects.toThrow();
  });

  it("rejects valid JSON with invalid retain job shape in strict reads", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({ id: "wrong-shape" })}\n${JSON.stringify(job)}\n`,
      "utf8",
    );

    await expect(readRetainQueue(path)).rejects.toThrow(
      `Malformed queue file ${path}: 1 invalid line(s)`,
    );
  });

  it("summarizes active and dead-letter queues without throwing on malformed lines", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    writeFileSync(
      path,
      `{not json}\n${JSON.stringify({ id: "wrong-shape" })}\n${JSON.stringify(job)}\n`,
      "utf8",
    );
    writeFileSync(
      resolveDeadLetterQueuePath(path),
      `{bad}\n${JSON.stringify({ ...job, id: "dead" })}\n`,
      "utf8",
    );

    await expect(readRetainQueue(path)).rejects.toThrow();
    const summary = await summarizeRetainQueue(path);

    expect(summary.active).toMatchObject({ path, valid: 1, malformed: 2, error: null });
    expect(summary.deadLetter).toMatchObject({
      path: resolveDeadLetterQueuePath(path),
      valid: 1,
      malformed: 1,
      error: null,
    });
  });

  it.each(stressCases)(
    "quarantines malformed active lines and flushes valid queued jobs under stress %#",
    async (index) => {
      const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
      writeFileSync(
        path,
        `{not json ${index}}\nnull\n{"id":"wrong-shape-${index}"}\n${JSON.stringify({ ...job, id: `valid-${index}` })}\n`,
        "utf8",
      );
      const calls: unknown[] = [];

      const result = await flushRetainQueue(path, {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      });

      expect(result).toMatchObject({ sent: 1, remaining: 0, deadLettered: 0, malformed: 3 });
      expect(calls).toHaveLength(1);
      expect(await readRetainQueue(path)).toHaveLength(0);
      const malformed = readFileSync(resolveMalformedQueuePath(path), "utf8");
      expect(malformed).toContain(`{not json ${index}}`);
      expect(malformed).toContain("null");
      expect(malformed).toContain(`wrong-shape-${index}`);
    },
  );

  it("forwards queued observation scopes to retain", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, {
      ...job,
      item: { ...job.item, observationScopes: [["repo:abc"], ["bank:b"]] },
    });
    const calls: unknown[] = [];

    await flushRetainQueue(path, {
      retain: async (...args: unknown[]) => {
        calls.push(args);
      },
      recall: async () => [],
      reflect: async () => ({}),
    });

    expect(calls[0]).toMatchObject(["b", "raw", { observationScopes: [["repo:abc"], ["bank:b"]] }]);
  });

  it("keeps failed append jobs in the queue when append is unsupported", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    const calls: unknown[] = [];

    const result = await flushRetainQueue(path, {
      retain: async (...args: unknown[]) => {
        calls.push(args);
        throw new Error(
          `retain failed: [{"loc":["body","items",0,"update_mode"],"msg":"Input should be 'replace'","input":"append"}]`,
        );
      },
      recall: async () => [],
      reflect: async () => ({}),
    });

    expect(result).toMatchObject({ sent: 0, remaining: 1, deadLettered: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(["b", "raw", { documentId: "doc", updateMode: "append" }]);
    expect(await readRetainQueue(path)).toHaveLength(1);
  });

  it.each(stressCases)(
    "moves exhausted failed jobs to the dead-letter queue under stress %#",
    async (index) => {
      const path = await createQueueWithJob(`failed-${index}`);
      const result = await flushRetainQueue(
        path,
        {
          retain: async () => {
            throw new Error(`down-${index}`);
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
        { maxRetries: 1 },
      );
      expect(result).toMatchObject({ sent: 0, remaining: 0, deadLettered: 1 });
      expect(await readRetainQueue(path)).toHaveLength(0);
      const dead = await readDeadLetterQueue(path);
      expect(dead).toHaveLength(1);
      expect(dead[0]?.id).toBe(`failed-${index}`);
      expect(dead[0]?.retries).toBe(1);
      expect(dead[0]?.lastError).toContain("moved to dead-letter queue");
      expect(dead[0]?.lastError).toContain(`down-${index}`);
      expect(dead[0]?.deadLetteredAt).toBeDefined();
    },
  );

  it("does not duplicate dead-letter jobs by id", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    await writeRetainQueue(resolveDeadLetterQueuePath(path), [
      {
        ...job,
        retries: 1,
        lastError: "previous dead-letter append before crash",
        deadLetteredAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = await flushRetainQueue(
      path,
      {
        retain: async () => {
          throw new Error("down again");
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
      { maxRetries: 1 },
    );

    expect(result).toMatchObject({ sent: 0, remaining: 0, deadLettered: 0 });
    expect(await readRetainQueue(path)).toHaveLength(0);
    const dead = await readDeadLetterQueue(path);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.lastError).toBe("previous dead-letter append before crash");
  });

  it("redacts secrets from persisted queue errors", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);

    await flushRetainQueue(
      path,
      {
        retain: async () => {
          throw new Error(
            'failed Cookie: sid=secret123456\npassword: hunter2\n{"token":"jsonsecret123456"}\nhttps://example.com/callback?ok=1&access_token=querysecret123456',
          );
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
      { maxRetries: 2 },
    );

    const [queued] = await readRetainQueue(path);
    expect(queued?.lastError).toContain("Cookie: [REDACTED]");
    expect(queued?.lastError).toContain("password: [REDACTED]");
    expect(queued?.lastError).toContain('"token":"[REDACTED]"');
    expect(queued?.lastError).toContain("access_token=[REDACTED]");
    expect(queued?.lastError).not.toContain("secret123456");
    expect(queued?.lastError).not.toContain("hunter2");
    expect(queued?.lastError).not.toContain("jsonsecret");
    expect(queued?.lastError).not.toContain("querysecret");
  });

  it("keeps exhausted jobs active when dead-letter append fails", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    mkdirSync(resolveDeadLetterQueuePath(path));

    await expect(
      flushRetainQueue(
        path,
        {
          retain: async () => {
            throw new Error("down");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
        { maxRetries: 1 },
      ),
    ).rejects.toThrow();

    const remaining = await readRetainQueue(path);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("1");
  });

  it("can bound shutdown flushing to avoid blocking session switches", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, { ...job, id: "1" });
    await enqueueRetainJob(path, { ...job, id: "2" });
    await enqueueRetainJob(path, { ...job, id: "3" });
    const calls: unknown[] = [];
    const result = await flushRetainQueue(
      path,
      {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
      { maxJobs: 1 },
    );
    expect(result.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect((await readRetainQueue(path)).map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("stops bounded flushing between jobs instead of leaving background work", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, { ...job, id: "1" });
    await enqueueRetainJob(path, { ...job, id: "2" });
    const calls: unknown[] = [];
    const result = await flushRetainQueue(
      path,
      {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
      { maxElapsedMs: 0 },
    );
    expect(result.sent).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await readRetainQueue(path)).map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("stops shutdown flushing after first failure", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, { ...job, id: "1" });
    await enqueueRetainJob(path, { ...job, id: "2" });
    const result = await flushRetainQueue(
      path,
      {
        retain: async () => {
          throw new Error("down");
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
      { stopOnFirstFailure: true },
    );
    expect(result.sent).toBe(0);
    const remaining = await readRetainQueue(path);
    expect(remaining.map((item) => item.id)).toEqual(["1", "2"]);
    expect(remaining[0]?.retries).toBe(1);
    expect(remaining[1]?.retries).toBe(0);
  });

  it("does not lose jobs appended while a flush is in progress", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, { ...job, id: "1" });
    let releaseRetain!: () => void;
    const retainStarted = new Promise<void>((resolve) => {
      releaseRetain = resolve;
    });
    let retainEntered!: () => void;
    const retainEnteredPromise = new Promise<void>((resolve) => {
      retainEntered = resolve;
    });

    const flush = flushRetainQueue(path, {
      retain: async () => {
        retainEntered();
        await retainStarted;
      },
      recall: async () => [],
      reflect: async () => ({}),
    });
    await retainEnteredPromise;
    const enqueue = enqueueRetainJob(path, { ...job, id: "2" });
    releaseRetain();

    await Promise.all([flush, enqueue]);
    expect((await readRetainQueue(path)).map((item) => item.id)).toEqual(["2"]);
  });

  it("resolves relative queue paths against cwd", () => {
    expect(resolveQueuePath("/repo", ".pi/hindsight/q.jsonl")).toBe(
      join("/repo", ".pi/hindsight/q.jsonl"),
    );
    expect(resolveQueuePath("/repo", "/tmp/q.jsonl")).toBe("/tmp/q.jsonl");
    expect(resolveDeadLetterQueuePath("/tmp/q.jsonl")).toBe("/tmp/q.jsonl.dead.jsonl");
  });

  it("does not remove fresh owner locks while waiting", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const lockPath = `${path}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, "owner"),
      JSON.stringify({ pid: 123, acquiredAt: new Date().toISOString() }),
    );
    const originalStaleMs = RETAIN_QUEUE_LOCK.staleMs;
    const originalTimeoutMs = RETAIN_QUEUE_LOCK.timeoutMs;
    const originalRetryMs = RETAIN_QUEUE_LOCK.retryMs;
    RETAIN_QUEUE_LOCK.staleMs = 30_000;
    RETAIN_QUEUE_LOCK.timeoutMs = 50;
    RETAIN_QUEUE_LOCK.retryMs = 1;
    try {
      await expect(enqueueRetainJob(path, job)).rejects.toThrow(/Timed out waiting/);
      expect(existsSync(lockPath)).toBe(true);
      expect(await readRetainQueue(path)).toHaveLength(0);
    } finally {
      RETAIN_QUEUE_LOCK.staleMs = originalStaleMs;
      RETAIN_QUEUE_LOCK.timeoutMs = originalTimeoutMs;
      RETAIN_QUEUE_LOCK.retryMs = originalRetryMs;
    }
  });

  it("cleans stale lock directories instead of waiting forever", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const lockPath = `${path}.lock`;
    mkdirSync(lockPath, { recursive: true });
    const oldTime = new Date(Date.now() - 10_000);
    utimesSync(lockPath, oldTime, oldTime);
    const originalStaleMs = RETAIN_QUEUE_LOCK.staleMs;
    const originalTimeoutMs = RETAIN_QUEUE_LOCK.timeoutMs;
    const originalRetryMs = RETAIN_QUEUE_LOCK.retryMs;
    RETAIN_QUEUE_LOCK.staleMs = 1;
    RETAIN_QUEUE_LOCK.timeoutMs = 200;
    RETAIN_QUEUE_LOCK.retryMs = 1;
    try {
      await enqueueRetainJob(path, job);
      expect((await readRetainQueue(path)).map((item) => item.id)).toEqual(["1"]);
    } finally {
      RETAIN_QUEUE_LOCK.staleMs = originalStaleMs;
      RETAIN_QUEUE_LOCK.timeoutMs = originalTimeoutMs;
      RETAIN_QUEUE_LOCK.retryMs = originalRetryMs;
    }
  });

  it.each(stressCases)(
    "does not lose jobs when multiple processes enqueue concurrently under stress %#",
    async (run) => {
      const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
      await Promise.all(
        Array.from({ length: 8 }, (_, index) => runWorker("enqueue", path, `${run}-${index}`)),
      );
      expect((await readRetainQueue(path)).map((item) => item.id).sort()).toEqual([
        `${run}-0`,
        `${run}-1`,
        `${run}-2`,
        `${run}-3`,
        `${run}-4`,
        `${run}-5`,
        `${run}-6`,
        `${run}-7`,
      ]);
    },
  );
});
