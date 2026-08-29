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
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { isQueueLockRaceError } from "../extensions/queue/queue-lock.js";
import { canonicalRetainJobJson } from "../extensions/queue/retain-before-enqueue.js";
import {
  canCoalesceRetainJobs,
  coalesceRetainJob,
  enqueueRetain,
  enqueueRetainCoalesced,
  enqueueRetainJob,
  enqueueRetainJobCoalesced,
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
} from "../extensions/queue/queue.js";
import {
  operationIdsFromResponse,
  parseRetainOutcome,
  retainOptionsForJob,
} from "../extensions/queue/queue-delivery.js";
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

function runWorker(mode: string, path: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/queue-worker.mjs", mode, path, id],
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

function writeChecker(dir: string, body: string): string {
  const path = join(dir, "checker.mjs");
  writeFileSync(path, body);
  return path;
}

describe("retain queue", () => {
  it("classifies Windows lock-directory race errors as retryable contention", () => {
    expect(isQueueLockRaceError(Object.assign(new Error("exists"), { code: "EEXIST" }))).toBe(true);
    expect(
      isQueueLockRaceError(Object.assign(new Error("transient eperm"), { code: "EPERM" })),
    ).toBe(true);
    expect(isQueueLockRaceError(Object.assign(new Error("busy"), { code: "EBUSY" }))).toBe(true);
    expect(isQueueLockRaceError(Object.assign(new Error("not empty"), { code: "ENOTEMPTY" }))).toBe(
      true,
    );
    expect(isQueueLockRaceError(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(
      false,
    );
    expect(
      isQueueLockRaceError(Object.assign(new Error("access denied"), { code: "EACCES" })),
    ).toBe(false);
  });

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
          documentTags: ["doc:test"],
          strategy: "conversation",
        },
      }),
    ).toMatchObject({
      context: "ctx",
      timestamp: "2026-01-01T00:00:00.000Z",
      metadata: { source: "test" },
      async: true,
      operationId: job.id,
      entities: [{ text: "entity", type: "thing" }],
      tags: ["source:pi"],
      observationScopes: [["repo:abc"]],
      documentTags: ["doc:test"],
      strategy: "conversation",
      documentId: "doc",
      updateMode: "append",
    });
  });

  it("extracts async operation IDs from retain responses", () => {
    expect(operationIdsFromResponse(undefined)).toEqual([]);
    expect(operationIdsFromResponse({ operation_id: "op-1", operationId: "op-1" })).toEqual([
      "op-1",
    ]);
    expect(
      operationIdsFromResponse({
        operations: ["op-2", { id: "op-3" }, { operation_id: "op-4" }],
        operation_ids: ["op-5"],
      }),
    ).toEqual(["op-2", "op-3", "op-4", "op-5"]);
  });

  it("parses retain outcome metadata and tolerates old-server responses", () => {
    expect(parseRetainOutcome(undefined)).toEqual({ operationIds: [] });
    expect(parseRetainOutcome({ success: true, items_count: 3, async: false })).toEqual({
      operationIds: [],
      itemsCount: 3,
    });
    expect(
      parseRetainOutcome({ operation_id: "op-1", items_count: 2, usage: { total_tokens: 120 } }),
    ).toEqual({ operationIds: ["op-1"], itemsCount: 2, tokens: 120 });
    expect(parseRetainOutcome({ status: "ok" })).toEqual({ operationIds: [] });
  });

  it("aggregates retain outcome across delivered jobs", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    await enqueueRetainJob(path, { ...job, id: "2", documentId: "doc-2" });
    let n = 0;
    const result = await flushRetainQueue(path, {
      retain: async () => ({
        operation_id: `op-${++n}`,
        items_count: 2,
        usage: { total_tokens: 50 },
      }),
      recall: async () => [],
      reflect: async () => ({}),
    });
    expect(result.sent).toBe(2);
    expect(result.outcome).toEqual({ itemsCount: 4, operations: 2, tokens: 100 });
    expect(result.delivered).toHaveLength(2);
    expect(result.delivered?.[0]).toMatchObject({
      queueJobId: "1",
      documentId: "doc",
      outcome: { itemsCount: 2, operations: 1, tokens: 50 },
    });
  });

  it("omits outcome aggregates when the server returns no metadata", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    const result = await flushRetainQueue(path, {
      retain: async () => ({ status: "ok" }),
      recall: async () => [],
      reflect: async () => ({}),
    });
    expect(result.sent).toBe(1);
    expect(result.outcome).toBeUndefined();
    expect(result.operationIds).toBeUndefined();
    expect(result.delivered?.[0]?.outcome).toEqual({});
  });

  it("coalesces a compatible append job by merging JSON-array deltas into one queue entry", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const first: RetainJob = { ...job, item: { ...job.item, content: JSON.stringify([{ m: 1 }]) } };
    const second: RetainJob = {
      ...job,
      id: "2",
      item: { ...job.item, content: JSON.stringify([{ m: 2 }]), tags: ["source:pi", "extra"] },
    };
    const r1 = await enqueueRetainJobCoalesced(path, first);
    expect(r1).toEqual({ coalesced: false, currentLength: 1 });
    const r2 = await enqueueRetainJobCoalesced(path, second);
    expect(r2).toEqual({ coalesced: true, currentLength: 1 });
    const queued = await readRetainQueue(path);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.id).toBe("1");
    expect(JSON.parse(queued[0]?.item.content ?? "[]")).toEqual([{ m: 1 }, { m: 2 }]);
    expect(queued[0]?.item.tags).toEqual(["source:pi", "extra"]);
  });

  it("does not coalesce jobs targeting a different document or non-append mode", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJobCoalesced(path, job);
    const otherDoc = await enqueueRetainJobCoalesced(path, {
      ...job,
      id: "2",
      documentId: "doc-2",
    });
    expect(otherDoc.coalesced).toBe(false);
    const replaceJob = await enqueueRetainJobCoalesced(path, {
      ...job,
      id: "3",
      updateMode: "replace",
    });
    expect(replaceJob.coalesced).toBe(false);
    expect(await readRetainQueue(path)).toHaveLength(3);
  });

  it("canonicalizes retain job keys with deterministic code-point ordering", () => {
    const canonical = canonicalRetainJobJson({
      ...job,
      item: {
        ...job.item,
        metadata: {
          "\u{1f600}": "emoji",
          "\ue000": "private-use",
          a: "ascii",
        },
      },
    });

    expect(canonical.indexOf('"a": "ascii"')).toBeLessThan(
      canonical.indexOf('"\ue000": "private-use"'),
    );
    expect(canonical.indexOf('"\ue000": "private-use"')).toBeLessThan(
      canonical.indexOf('"\u{1f600}": "emoji"'),
    );
  });

  it("runs retain.beforeEnqueue with sanitized canonical job JSON before queue admission", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    const inputPath = join(cwd, "stdin.json");
    const checker = writeChecker(
      cwd,
      `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", async () => {
  const job = JSON.parse(input);
  if (input !== JSON.stringify(job, null, 2) + "\\n") process.exit(2);
  if (job.item.content.includes("sk-secret")) process.exit(3);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(${JSON.stringify(inputPath)}, input);
});
`,
    );
    const config = {
      ...DEFAULT_CONFIG,
      retain: {
        ...DEFAULT_CONFIG.retain,
        beforeEnqueue: { command: [process.execPath, checker], timeoutMs: 2_000 },
      },
    };

    const result = await enqueueRetain(cwd, config, {
      ...job,
      item: { ...job.item, content: "token [REDACTED]", metadata: { api_key: "[REDACTED]" } },
    });

    expect(result.currentLength).toBe(1);
    expect(readFileSync(inputPath, "utf8")).toContain('"documentId": "doc"');
    expect(await readRetainQueue(join(cwd, DEFAULT_CONFIG.retain.queuePath))).toHaveLength(1);
  });

  it("blocks queue admission on retain.beforeEnqueue nonzero exit without queue writes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    const checker = writeChecker(cwd, "process.exit(42);\n");
    const config = {
      ...DEFAULT_CONFIG,
      retain: {
        ...DEFAULT_CONFIG.retain,
        beforeEnqueue: { command: [process.execPath, checker], timeoutMs: 2_000 },
      },
    };

    await expect(enqueueRetain(cwd, config, job)).rejects.toThrow(
      "retain.beforeEnqueue blocked retain job before queue admission",
    );
    expect(existsSync(join(cwd, DEFAULT_CONFIG.retain.queuePath))).toBe(false);
  });

  it("checks the merged coalesced retain candidate and preserves existing queue content on rejection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    const inputPath = join(cwd, "stdin.json");
    const checker = writeChecker(
      cwd,
      `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", async () => {
  const job = JSON.parse(input);
  const content = JSON.parse(job.item.content);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(${JSON.stringify(inputPath)}, input);
  process.exit(JSON.stringify(content) === JSON.stringify([{ m: 1 }, { m: 2 }]) ? 42 : 0);
});
`,
    );
    const config = {
      ...DEFAULT_CONFIG,
      retain: {
        ...DEFAULT_CONFIG.retain,
        beforeEnqueue: { command: [process.execPath, checker], timeoutMs: 2_000 },
      },
    };
    const queuePath = join(cwd, DEFAULT_CONFIG.retain.queuePath);
    const existing: RetainJob = {
      ...job,
      item: { ...job.item, content: JSON.stringify([{ m: 1 }]) },
    };
    const incoming: RetainJob = {
      ...job,
      id: "2",
      item: { ...job.item, content: JSON.stringify([{ m: 2 }]) },
    };
    await enqueueRetainJob(queuePath, existing);

    await expect(enqueueRetainCoalesced(cwd, config, incoming)).rejects.toThrow(
      "retain.beforeEnqueue blocked retain job before queue admission",
    );

    expect(JSON.parse(JSON.parse(readFileSync(inputPath, "utf8")).item.content)).toEqual([
      { m: 1 },
      { m: 2 },
    ]);
    expect(await readRetainQueue(queuePath)).toEqual([existing]);
  });

  it("retries retain.beforeEnqueue outside the queue lock when the tail changes before admission", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const existing: RetainJob = {
      ...job,
      item: { ...job.item, content: JSON.stringify([{ m: 1 }]) },
    };
    const incoming: RetainJob = {
      ...job,
      id: "2",
      item: { ...job.item, content: JSON.stringify([{ m: 2 }]) },
    };
    const intervening: RetainJob = { ...job, id: "3", documentId: "doc-2" };
    await enqueueRetainJob(path, existing);

    let releaseFirstCheck!: () => void;
    let firstCheckStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstCheckStarted = resolve;
    });
    const checkedContents: unknown[] = [];
    const pending = enqueueRetainJobCoalesced(path, incoming, async (candidate) => {
      checkedContents.push(JSON.parse(candidate.item.content));
      if (checkedContents.length === 1) {
        firstCheckStarted();
        await new Promise<void>((resolve) => {
          releaseFirstCheck = resolve;
        });
      }
    });

    await started;
    await enqueueRetainJobCoalesced(path, intervening);
    releaseFirstCheck();

    await expect(pending).resolves.toEqual({ coalesced: false, currentLength: 3 });
    expect(checkedContents).toEqual([[{ m: 1 }, { m: 2 }], [{ m: 2 }]]);
    expect(await readRetainQueue(path)).toEqual([existing, intervening, incoming]);
  });

  it("rejects the final revalidated retain candidate without writing a stale checked candidate", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const existing: RetainJob = {
      ...job,
      item: { ...job.item, content: JSON.stringify([{ m: 1 }]) },
    };
    const incoming: RetainJob = {
      ...job,
      id: "2",
      item: { ...job.item, content: JSON.stringify([{ m: 2 }]) },
    };
    const intervening: RetainJob = { ...job, id: "3", documentId: "doc-2" };
    await enqueueRetainJob(path, existing);

    let releaseFirstCheck!: () => void;
    let firstCheckStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstCheckStarted = resolve;
    });
    const checkedContents: unknown[] = [];
    const pending = enqueueRetainJobCoalesced(path, incoming, async (candidate) => {
      const content = JSON.parse(candidate.item.content);
      checkedContents.push(content);
      if (checkedContents.length === 1) {
        firstCheckStarted();
        await new Promise<void>((resolve) => {
          releaseFirstCheck = resolve;
        });
        return;
      }
      if (JSON.stringify(content) === JSON.stringify([{ m: 2 }])) {
        throw new Error("blocked final candidate");
      }
    });

    await started;
    await enqueueRetainJobCoalesced(path, intervening);
    releaseFirstCheck();

    await expect(pending).rejects.toThrow("blocked final candidate");
    expect(checkedContents).toEqual([[{ m: 1 }, { m: 2 }], [{ m: 2 }]]);
    expect(await readRetainQueue(path)).toEqual([existing, intervening]);
  });

  it("blocks queue admission on retain.beforeEnqueue timeout and spawn failure", async () => {
    const timeoutCwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    const slowChecker = writeChecker(timeoutCwd, "setTimeout(() => {}, 1000);\n");
    await expect(
      enqueueRetain(
        timeoutCwd,
        {
          ...DEFAULT_CONFIG,
          retain: {
            ...DEFAULT_CONFIG.retain,
            beforeEnqueue: { command: [process.execPath, slowChecker], timeoutMs: 20 },
          },
        },
        job,
      ),
    ).rejects.toThrow("retain.beforeEnqueue timed out");
    expect(existsSync(join(timeoutCwd, DEFAULT_CONFIG.retain.queuePath))).toBe(false);

    const spawnCwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    await expect(
      enqueueRetain(
        spawnCwd,
        {
          ...DEFAULT_CONFIG,
          retain: {
            ...DEFAULT_CONFIG.retain,
            beforeEnqueue: { command: [join(spawnCwd, "missing-checker")], timeoutMs: 2_000 },
          },
        },
        job,
      ),
    ).rejects.toThrow("retain.beforeEnqueue could not start");
    expect(existsSync(join(spawnCwd, DEFAULT_CONFIG.retain.queuePath))).toBe(false);
  });

  it("blocks queue admission when retain.beforeEnqueue config is malformed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-before-enqueue-"));
    await expect(
      enqueueRetain(
        cwd,
        {
          ...DEFAULT_CONFIG,
          retain: {
            ...DEFAULT_CONFIG.retain,
            beforeEnqueue: { command: [], timeoutMs: 5_000, malformed: true },
          },
        },
        job,
      ),
    ).rejects.toThrow("retain.beforeEnqueue is malformed");
    expect(existsSync(join(cwd, DEFAULT_CONFIG.retain.queuePath))).toBe(false);
  });

  it("refuses to coalesce into a job that has already failed delivery", async () => {
    const failed: RetainJob = { ...job, retries: 1 };
    expect(canCoalesceRetainJobs(failed, { ...job, id: "2" })).toBe(false);
    // Content merge falls back to newline concatenation for non-JSON payloads.
    const merged = coalesceRetainJob(
      { ...job, item: { ...job.item, content: "a" } },
      { ...job, id: "2", item: { ...job.item, content: "b" } },
    );
    expect(merged.item.content).toBe("a\nb");
    expect(merged.id).toBe("1");
    // Valid JSON that is not an array also falls back to newline concatenation.
    const nonArray = coalesceRetainJob(
      { ...job, item: { ...job.item, content: '{"m":1}' } },
      { ...job, id: "2", item: { ...job.item, content: '{"m":2}' } },
    );
    expect(nonArray.item.content).toBe('{"m":1}\n{"m":2}');
    // One array + one non-array still falls back; empty tags omit the tags field.
    const mixed = coalesceRetainJob(
      { ...job, item: { content: JSON.stringify([{ m: 1 }]), context: "ctx" } },
      { ...job, id: "2", item: { content: '{"m":2}', context: "ctx" } },
    );
    expect(mixed.item.content).toBe(`${JSON.stringify([{ m: 1 }])}\n{"m":2}`);
    expect(mixed.item.tags).toBeUndefined();
  });

  it("does not coalesce past a non-mergeable tail job (preserves append order)", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    const older: RetainJob = {
      ...job,
      id: "1",
      item: { ...job.item, content: JSON.stringify([{ m: 1 }]) },
    };
    const failedTail: RetainJob = {
      ...job,
      id: "2",
      retries: 1,
      item: { ...job.item, content: JSON.stringify([{ m: 2 }]) },
    };
    const incoming: RetainJob = {
      ...job,
      id: "3",
      item: { ...job.item, content: JSON.stringify([{ m: 3 }]) },
    };
    await enqueueRetainJob(path, older);
    await enqueueRetainJob(path, failedTail);
    const result = await enqueueRetainJobCoalesced(path, incoming);
    expect(result).toEqual({ coalesced: false, currentLength: 3 });
    const queued = await readRetainQueue(path);
    expect(queued.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
    expect(JSON.parse(queued[0]?.item.content ?? "[]")).toEqual([{ m: 1 }]);
  });

  it("persists and flushes jobs", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-hindsight-q-")), "q.jsonl");
    await enqueueRetainJob(path, job);
    expect(await readRetainQueue(path)).toHaveLength(1);
    const calls: unknown[] = [];
    const result = await flushRetainQueue(path, {
      retain: async (...args: unknown[]) => {
        calls.push(args);
        return { operation_id: "op-retain" };
      },
      recall: async () => [],
      reflect: async () => ({}),
    });
    expect(result.sent).toBe(1);
    expect(result.operationIds).toEqual(["op-retain"]);
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
      const secondResult = await Promise.race<unknown>([
        enqueueRetainJob(path, { ...job, id: "2" }).then(
          () => new Error("second waiter unexpectedly acquired lock"),
          (error: unknown) => error,
        ),
        new Promise((resolve) =>
          setTimeout(() => resolve(new Error("second waiter hung behind failed waiter")), 500),
        ),
      ]);
      expect(String(secondResult)).toMatch(/Timed out waiting/);
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
