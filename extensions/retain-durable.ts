import { randomUUID } from "node:crypto";
import type {
  HindsightCapabilities,
  HindsightLikeClient,
  ResolvedConfig,
  RetainJob,
  UpdateMode,
} from "./types.js";
import {
  enqueueRetainJobWithStats,
  flushRetainQueue,
  readRetainQueue,
  resolveQueuePath,
} from "./queue.js";
import { redactSecrets } from "./sanitize.js";
import { resolveRetainDocumentTarget } from "./capabilities.js";

export type DurableRetainSource = "auto" | "tool" | "command" | "import";

export interface RetainDurablyArgs {
  cwd: string;
  config: ResolvedConfig;
  client: HindsightLikeClient;
  bankId: string;
  content: string;
  context: string;
  tags: string[];
  documentId: string;
  updateMode: UpdateMode;
  metadata?: Record<string, string>;
  source: DurableRetainSource;
  timestamp?: string;
  observationScopes?: string[][];
  capabilities?: HindsightCapabilities;
}

export interface RetainDurablyResult {
  enqueued: boolean;
  sent: number;
  remaining: number;
  deadLettered: number;
}

export function buildDurableRetainJob(args: Omit<RetainDurablyArgs, "client">): RetainJob {
  const content = args.config.retain.redactSecrets ? redactSecrets(args.content) : args.content;
  const target = resolveRetainDocumentTarget({
    config: args.config,
    ...(args.capabilities ? { capabilities: args.capabilities } : {}),
    documentId: args.documentId,
    updateMode: args.updateMode,
  });
  return {
    id: randomUUID(),
    bankId: args.bankId,
    createdAt: new Date().toISOString(),
    documentId: target.documentId,
    updateMode: target.updateMode,
    item: {
      content,
      context: args.context,
      timestamp: args.timestamp ?? new Date().toISOString(),
      async: args.config.retain.async,
      tags: args.tags,
      metadata: {
        source: "pi-hindsight",
        retainSource: args.source,
        ...args.metadata,
      },
      ...(args.observationScopes?.length ? { observationScopes: args.observationScopes } : {}),
    },
    retries: 0,
  };
}

export async function retainDurably(args: RetainDurablyArgs): Promise<RetainDurablyResult> {
  const queuePath = resolveQueuePath(args.cwd, args.config.retain.queuePath);
  const enqueueResult = await enqueueRetainJobWithStats(queuePath, buildDurableRetainJob(args));
  if (enqueueResult.previousLength > 0) {
    const remaining = (await readRetainQueue(queuePath)).length;
    return { enqueued: true, sent: 0, remaining, deadLettered: 0 };
  }
  const result = await flushRetainQueue(queuePath, args.client, { maxJobs: 1 });
  return { enqueued: true, ...result };
}
