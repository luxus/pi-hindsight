import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import type {
  HindsightCapabilities,
  HindsightLikeClient,
  ResolvedConfig,
  RetainJob,
} from "../types.js";
import { baseTags } from "../banks/banking.js";
import { projectMessages } from "../utils/messages.js";
import { contextLabel, liveDocumentId, stableSessionId } from "../utils/session.js";
import { enqueueRetain, flushRetain } from "./retain-queue.js";
import { createMemoryIdentity } from "../operations/memory-identity.js";
import { expandObservationScopes } from "./observation-scopes.js";
import { buildRetainJob as buildRetainJobCore } from "./retain-job-builder.js";

export function buildRetainJob(args: {
  config: ResolvedConfig;
  cwd: string;
  sessionFile?: string;
  bankId: string;
  messages: AgentEndEvent["messages"];
  capabilities?: HindsightCapabilities;
  extraTags?: string[];
}): RetainJob | undefined {
  const projected = projectMessages(args.messages, args.config);
  if (projected.length === 0) return undefined;
  const content = JSON.stringify(projected, null, 2);
  const sessionId = stableSessionId(args.sessionFile, args.cwd);
  const identity = createMemoryIdentity(args.cwd, args.config, args.sessionFile);
  const observationScopes = args.config.observations.enabled
    ? expandObservationScopes(args.config.observations.scopes, {
        ...identity,
        projectBankId: args.bankId,
      })
    : [];
  return buildRetainJobCore({
    config: args.config,
    bankId: args.bankId,
    content,
    context: contextLabel(args.cwd, args.sessionFile),
    documentId: liveDocumentId(args.sessionFile, args.cwd),
    updateMode: args.config.retain.updateMode,
    tags: [...new Set([...baseTags(args.cwd, sessionId), ...(args.extraTags ?? [])])],
    metadata: {
      cwd: args.cwd,
      imported: "false",
      ...(args.sessionFile ? { pi_session_file: args.sessionFile } : {}),
    },
    ...(observationScopes.length ? { observationScopes } : {}),
    ...(args.capabilities ? { capabilities: args.capabilities } : {}),
  });
}

export async function enqueueRetainFromAgentEnd(args: {
  event: AgentEndEvent;
  cwd: string;
  sessionFile?: string;
  config: ResolvedConfig;
  client: HindsightLikeClient;
  bankId: string;
  capabilities?: HindsightCapabilities;
  extraTags?: string[];
}): Promise<{ queued: boolean; sent: number; remaining: number }> {
  if (!args.config.enabled || !args.config.retain.enabled)
    return { queued: false, sent: 0, remaining: 0 };
  const job = buildRetainJob({
    config: args.config,
    cwd: args.cwd,
    ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
    bankId: args.bankId,
    messages: args.event.messages,
    ...(args.capabilities ? { capabilities: args.capabilities } : {}),
    ...(args.extraTags ? { extraTags: args.extraTags } : {}),
  });
  if (!job) return { queued: false, sent: 0, remaining: 0 };
  await enqueueRetain(args.cwd, args.config, job);
  const result = await flushRetain(args.cwd, args.config, args.client);
  if (args.config.retain.postRetainReflect) {
    try {
      await args.client.reflect(
        args.bankId,
        "Reflect on the recently retained session to extract insights",
        { context: "Post-retain reflection" },
      );
    } catch {
      /* best-effort reflect after retain */
    }
  }
  return { queued: true, sent: result.sent, remaining: result.remaining };
}
