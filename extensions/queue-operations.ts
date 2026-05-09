import {
  resolveQueuePath,
  summarizeRetainQueue,
  readRetainQueueTolerant,
  readDeadLetterQueueTolerant,
} from "./queue.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { redactError } from "./sanitize.js";
import type { RetainJob } from "./types.js";

function redactJob(job: RetainJob) {
  return {
    id: job.id,
    bankId: job.bankId,
    documentId: job.documentId,
    updateMode: job.updateMode,
    retries: job.retries,
    lastError: job.lastError ? redactError(job.lastError) : undefined,
    deadLetteredAt: job.deadLetteredAt,
    tags: job.item.tags,
    metadataKeys: job.item.metadata ? Object.keys(job.item.metadata).sort() : undefined,
    contentBytes: Buffer.byteLength(job.item.content, "utf8"),
    contextBytes: Buffer.byteLength(job.item.context, "utf8"),
  };
}

export function createQueueOperations(deps: MemoryOperationsDeps) {
  return {
    async inspectRetainQueue(args: { cwd: string; includeJobs?: boolean }) {
      const config = deps.getConfig();
      const queuePath = resolveQueuePath(args.cwd, config.retain.queuePath);
      const summary = await summarizeRetainQueue(queuePath);
      const activeJobs = args.includeJobs
        ? await readRetainQueueTolerant(queuePath)
            .then((parsed) => parsed.jobs)
            .catch(() => [])
        : [];
      const deadLetterJobs = args.includeJobs
        ? await readDeadLetterQueueTolerant(queuePath)
            .then((parsed) => parsed.jobs)
            .catch(() => [])
        : [];
      return {
        queuePath,
        deadLetterPath: `${queuePath}.dead.jsonl`,
        active: summary.active,
        deadLetter: summary.deadLetter,
        jobs: args.includeJobs
          ? {
              active: activeJobs.map(redactJob),
              deadLetter: deadLetterJobs.map(redactJob),
            }
          : undefined,
      };
    },
  };
}
