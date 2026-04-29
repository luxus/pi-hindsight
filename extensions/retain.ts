import { randomUUID } from "node:crypto";
import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import type {
  HindsightCapabilities,
  HindsightLikeClient,
  ResolvedConfig,
  RetainJob,
} from "./types.js";
import { baseTags } from "./banking.js";
import { projectMessages } from "./messages.js";
import { redactSecrets } from "./sanitize.js";
import { contextLabel, liveDocumentId, stableSessionId } from "./session.js";
import { enqueueRetainJob, flushRetainQueue, resolveQueuePath } from "./queue.js";
import { resolveRetainDocumentTarget } from "./capabilities.js";
import { createMemoryIdentity } from "./memory-identity.js";
import { expandObservationScopes } from "./observation-scopes.js";

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
  const content = args.config.retain.redactSecrets
    ? redactSecrets(JSON.stringify(projected, null, 2))
    : JSON.stringify(projected, null, 2);
  const sessionId = stableSessionId(args.sessionFile, args.cwd);
  const identity = createMemoryIdentity(args.cwd, args.config, args.sessionFile);
  const observationScopes = args.config.observations.enabled
    ? expandObservationScopes(args.config.observations.scopes, {
        ...identity,
        projectBankId: args.bankId,
      })
    : [];
  const baseDocumentId = liveDocumentId(args.sessionFile, args.cwd);
  const target = resolveRetainDocumentTarget({
    config: args.config,
    ...(args.capabilities ? { capabilities: args.capabilities } : {}),
    documentId: baseDocumentId,
    updateMode: args.config.retain.updateMode,
  });
  return {
    id: randomUUID(),
    bankId: args.bankId,
    createdAt: new Date().toISOString(),
    documentId: target.documentId,
    updateMode: target.updateMode,
    item: {
      content,
      context: contextLabel(args.cwd, args.sessionFile),
      timestamp: new Date().toISOString(),
      async: args.config.retain.async,
      ...(args.config.retain.entities.length ? { entities: args.config.retain.entities } : {}),
      tags: [...new Set([...baseTags(args.cwd, sessionId), ...(args.extraTags ?? [])])],
      metadata: {
        cwd: args.cwd,
        imported: "false",
        ...(args.sessionFile ? { pi_session_file: args.sessionFile } : {}),
      },
      ...(observationScopes.length ? { observationScopes } : {}),
    },
    retries: 0,
  };
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
  const queuePath = resolveQueuePath(args.cwd, args.config.retain.queuePath);
  await enqueueRetainJob(queuePath, job);
  const result = await flushRetainQueue(queuePath, args.client);
  return { queued: true, sent: result.sent, remaining: result.remaining };
}
