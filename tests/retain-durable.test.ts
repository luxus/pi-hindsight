import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
import {
  flushRetainQueue,
  readDeadLetterQueue,
  readRetainQueue,
  resolveQueuePath,
} from "../extensions/queue.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";
import {
  setSessionMemoryMode,
  setSessionRetainEnabled,
} from "../extensions/session-memory-meta.js";

function testConfig(queuePath = ".pi/hindsight/q.jsonl"): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    retain: { ...DEFAULT_CONFIG.retain, queuePath, redactSecrets: true },
  };
}

function client(retain: HindsightLikeClient["retain"]): HindsightLikeClient {
  return {
    retain,
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("durable explicit retain", () => {
  it("queues explicit retain when Hindsight is down", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () =>
        client(async () => {
          throw new Error("down");
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    const result = await operations.retainExplicit({
      cwd,
      sessionFile: "/tmp/session.jsonl",
      content: "Durable fact with API_KEY=super-secret",
      context: "unit test explicit retain",
      tags: ["decision:test"],
    });

    expect(result).toMatchObject({
      bankId: "project-bank",
      enqueued: true,
      queued: true,
      sent: 0,
      remaining: 1,
      deadLettered: 0,
    });
    expect(result.tags).toEqual(expect.arrayContaining(["source:pi", "decision:test"]));

    const queued = await readRetainQueue(resolveQueuePath(cwd, config.retain.queuePath));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      bankId: "project-bank",
      updateMode: "replace",
      retries: 1,
      item: {
        context: "unit test explicit retain",
        async: true,
        metadata: {
          source: "pi-hindsight",
          retainSource: "tool",
          cwd,
          pi_session_file: "/tmp/session.jsonl",
        },
      },
    });
    expect(queued[0]?.documentId).toMatch(/^pi-explicit:/);
    expect(queued[0]?.item.content).toContain("Durable fact");
    expect(queued[0]?.item.content).not.toContain("super-secret");
    expect(queued[0]?.item.tags).toEqual(expect.arrayContaining(["source:pi", "decision:test"]));
  });

  it("passes configured observation scopes for explicit retain", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config: ResolvedConfig = {
      ...testConfig(),
      observations: { enabled: true, scopes: [["repo:{repoKey}"], ["bank:{projectBankId}"]] },
    };
    const operations = createMemoryOperations({
      getClient: () =>
        client(async () => {
          throw new Error("down");
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await operations.retainExplicit({
      cwd,
      content: "Durable fact",
      context: "unit test explicit retain",
      bank: "custom-bank",
    });

    const queued = await readRetainQueue(resolveQueuePath(cwd, config.retain.queuePath));
    expect(queued[0]?.item.observationScopes).toEqual([
      [expect.stringMatching(/^repo:/)],
      ["bank:custom-bank"],
    ]);
  });

  it("does not burn retries on existing backlog during a continuous outage", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () =>
        client(async () => {
          throw new Error("down");
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    for (let index = 0; index < 7; index += 1) {
      await operations.retainExplicit({
        cwd,
        content: `Decision ${index}`,
        context: "unit test explicit retain",
      });
    }

    const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
    const queued = await readRetainQueue(queuePath);
    expect(queued).toHaveLength(7);
    expect(queued[0]?.retries).toBe(1);
    expect(queued.slice(1).every((queuedJob) => queuedJob.retries === 0)).toBe(true);
    expect(await readDeadLetterQueue(queuePath)).toHaveLength(0);
  });

  it("keeps explicit retain queued when existing backlog contains malformed lines", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
    mkdirSync(dirname(queuePath), { recursive: true });
    writeFileSync(queuePath, "{bad json}\n", "utf8");
    const operations = createMemoryOperations({
      getClient: () => client(async () => undefined),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    const result = await operations.retainExplicit({
      cwd,
      content: "Decision with malformed backlog",
      context: "unit test explicit retain",
    });

    expect(result).toMatchObject({ enqueued: true, sent: 0, remaining: 2, deadLettered: 0 });
  });

  it("does not burn retries when explicit retains race during an outage", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () =>
        client(async () => {
          throw new Error("down");
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        operations.retainExplicit({
          cwd,
          content: `Decision ${index}`,
          context: "unit test explicit retain",
        }),
      ),
    );

    const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
    const queued = await readRetainQueue(queuePath);
    expect(queued).toHaveLength(7);
    expect(queued.filter((queuedJob) => queuedJob.retries === 1)).toHaveLength(1);
    expect(queued.filter((queuedJob) => queuedJob.retries === 0)).toHaveLength(6);
    expect(await readDeadLetterQueue(queuePath)).toHaveLength(0);
  });

  it("flushes queued explicit retain later", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () =>
        client(async () => {
          throw new Error("down");
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await operations.retainExplicit({
      cwd,
      content: "Decision: queue first.",
      context: "unit test explicit retain",
    });

    const calls: unknown[] = [];
    const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
    const result = await flushRetainQueue(
      queuePath,
      client(async (...args: unknown[]) => {
        calls.push(args);
      }),
    );

    expect(result).toMatchObject({ sent: 1, remaining: 0, deadLettered: 0 });
    expect(await readRetainQueue(queuePath)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([
      "project-bank",
      "Decision: queue first.",
      {
        context: "unit test explicit retain",
        async: true,
        updateMode: "replace",
      },
    ]);
  });

  it("uses replace for explicit retains so receipts can be deleted precisely", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () => client(async () => undefined),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
      getCapabilities: () => ({ appendUpdateMode: false, checkedAt: "now" }),
    });

    const result = await operations.retainExplicit({
      cwd,
      content: "Decision: precise delete target.",
      context: "unit test explicit retain",
    });

    expect(result.updateMode).toBe("replace");
    expect(result.documentId).toMatch(/^pi-explicit:/);
  });

  it("blocks explicit recall and retain when session governance disables them", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const sessionFile = "/tmp/session.jsonl";
    const config = testConfig();
    const operations = createMemoryOperations({
      getClient: () => client(async () => undefined),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await setSessionMemoryMode(cwd, sessionFile, "ignored");
    await expect(operations.recall(cwd, "q", undefined, sessionFile)).rejects.toThrow(
      /recall is disabled/,
    );
    await expect(
      operations.retainExplicit({ cwd, sessionFile, content: "x", context: "ctx" }),
    ).rejects.toThrow(/retain is disabled/);

    await setSessionMemoryMode(cwd, sessionFile, "normal");
    await setSessionRetainEnabled(cwd, sessionFile, false);
    await expect(
      operations.retainExplicit({ cwd, sessionFile, content: "x", context: "ctx" }),
    ).rejects.toThrow(/retain is disabled/);
  });

  it("sends explicit retain immediately after enqueue when Hindsight is up", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-retain-"));
    const config = testConfig();
    const calls: unknown[] = [];
    const operations = createMemoryOperations({
      getClient: () =>
        client(async (...args: unknown[]) => {
          calls.push(args);
        }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    const result = await operations.retainExplicit({
      cwd,
      content: "Decision: flush now.",
      context: "unit test explicit retain",
    });

    expect(result).toMatchObject({ enqueued: true, sent: 1, remaining: 0, deadLettered: 0 });
    expect(await readRetainQueue(resolveQueuePath(cwd, config.retain.queuePath))).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
});
