import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createQueueOperations } from "../extensions/queue-operations.js";
import { enqueueRetainJob, resolveQueuePath } from "../extensions/queue.js";
import type { RetainJob } from "../extensions/types.js";

function job(cwd: string): RetainJob {
  return {
    id: "job-1",
    bankId: "bank",
    createdAt: "2026-05-09T00:00:00.000Z",
    documentId: "doc-1",
    updateMode: "append",
    retries: 1,
    lastError: "failed with api_key=secret1234567890",
    item: {
      content: "secret payload content",
      context: "secret context",
      tags: ["source:pi"],
      metadata: { cwd, pi_session_file: join(cwd, "session.jsonl"), safe: "value" },
    },
  };
}

describe("queue operations", () => {
  it("returns queue summaries and redacted job metadata without payloads or metadata values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-queue-ops-"));
    const queuePath = resolveQueuePath(cwd, DEFAULT_CONFIG.retain.queuePath);
    await enqueueRetainJob(queuePath, job(cwd));
    await appendFile(queuePath, "{malformed json\n", "utf8");
    await writeFile(
      `${queuePath}.dead.jsonl`,
      `${JSON.stringify(job(cwd)).replace("job-1", "dead-1")}\n{malformed dead json\n`,
    );
    const ops = createQueueOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    const result = await ops.inspectRetainQueue({ cwd, includeJobs: true });

    expect(result.active.valid).toBe(1);
    expect(result.active.malformed).toBe(1);
    expect(result.deadLetter.valid).toBe(1);
    expect(result.deadLetter.malformed).toBe(1);
    expect(result.jobs?.active[0]).toMatchObject({
      id: "job-1",
      metadataKeys: ["cwd", "pi_session_file", "safe"],
      contentBytes: Buffer.byteLength("secret payload content", "utf8"),
      contextBytes: Buffer.byteLength("secret context", "utf8"),
      lastError: "failed with api_key=[REDACTED]",
    });
    const jobsJson = JSON.stringify(result.jobs);
    expect(jobsJson).not.toContain("secret payload content");
    expect(jobsJson).not.toContain("secret context");
    expect(jobsJson).not.toContain("session.jsonl");
    expect(jobsJson).not.toContain(cwd);
  });
});
