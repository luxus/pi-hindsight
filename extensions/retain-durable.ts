import type {
  HindsightCapabilities,
  HindsightLikeClient,
  ResolvedConfig,
  RetainJob,
  UpdateMode,
} from "./types.js";
import { enqueueRetainWithStats, flushRetain, summarizeRetain } from "./retain-queue.js";
import { buildRetainJob } from "./retain-job-builder.js";

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
  entities?: RetainJob["item"]["entities"];
  async?: boolean;
  capabilities?: HindsightCapabilities;
}

export interface RetainDurablyResult {
  enqueued: boolean;
  sent: number;
  remaining: number;
  deadLettered: number;
  bankId: string;
  documentId: string;
  queueJobId: string;
  updateMode: UpdateMode;
}

export function buildDurableRetainJob(args: Omit<RetainDurablyArgs, "client">): RetainJob {
  return buildRetainJob({
    ...args,
    metadata: {
      ...args.metadata,
      source: "pi-hindsight",
      retainSource: args.source,
    },
  });
}

export async function retainDurably(args: RetainDurablyArgs): Promise<RetainDurablyResult> {
  const job = buildDurableRetainJob(args);
  const receipt = {
    bankId: job.bankId,
    documentId: job.documentId,
    queueJobId: job.id,
    updateMode: job.updateMode,
  };
  const enqueueResult = await enqueueRetainWithStats(args.cwd, args.config, job);
  if (enqueueResult.previousLength > 0) {
    const summary = await summarizeRetain(args.cwd, args.config);
    return {
      ...receipt,
      enqueued: true,
      sent: 0,
      remaining: summary.active.valid + summary.active.malformed,
      deadLettered: 0,
    };
  }
  const result = await flushRetain(args.cwd, args.config, args.client, { maxJobs: 1 });
  return { ...receipt, enqueued: true, ...result };
}
