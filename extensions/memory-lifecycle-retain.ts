import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { projectMessages } from "./messages.js";
import { routeMemoryCandidate, type MemoryRouteDecision } from "./memory-router.js";
import { enqueueRetainFromAgentEnd } from "./retain.js";
import {
  addRetainFingerprints,
  messageFingerprint,
  readRetainFingerprints,
} from "./retain-cursor.js";
import { stableSessionId } from "./session.js";
import {
  clearNextSessionRetainMode,
  getEffectiveSessionMemoryMode,
  readSessionMemoryMeta,
} from "./session-memory-meta.js";
import { redactError } from "./sanitize.js";
import type { HindsightCapabilities, HindsightLikeClient, ResolvedConfig } from "./types.js";
import type { RuntimeSnapshot } from "./memory-lifecycle-runtime.js";
import type { HindsightActivity } from "./status.js";

export type RetainStatusActivity = Extract<
  HindsightActivity,
  "retaining" | "retained" | "retain-queued" | "retain-failed"
>;

export interface RetainTurnPolicy {
  retain(event: AgentEndEvent, runtime: RuntimeSnapshot): Promise<RetainTurnResult>;
}

export interface RetainTurnResult {
  queued: boolean;
  sent: number;
  remaining: number;
}

export interface RetainTurnPolicyDeps {
  getConfig(): ResolvedConfig;
  getClient(): HindsightLikeClient;
  getProjectBankId(): string;
  getCapabilities(): HindsightCapabilities | undefined;
  setMemoryStatus(
    runtime: RuntimeSnapshot,
    activity: RetainStatusActivity,
    queueRemaining?: number,
  ): void;
  notify(runtime: RuntimeSnapshot, message: string, level: "info" | "warning"): void;
}

export function createRetainTurnPolicy(deps: RetainTurnPolicyDeps): RetainTurnPolicy {
  const retainedBySession = new Map<string, Set<string>>();

  const newRetainMessages = async (
    runtime: RuntimeSnapshot,
    messages: AgentEndEvent["messages"],
  ): Promise<AgentEndEvent["messages"]> => {
    const sessionId = stableSessionId(runtime.sessionFile, runtime.cwd);
    const seen =
      retainedBySession.get(sessionId) ?? (await readRetainFingerprints(runtime.cwd, sessionId));
    retainedBySession.set(sessionId, seen);
    return messages.filter(
      (message) => !seen.has(messageFingerprint(message as AgentMessage)),
    ) as AgentEndEvent["messages"];
  };

  const markRetainedMessages = async (
    runtime: RuntimeSnapshot,
    messages: AgentEndEvent["messages"],
  ): Promise<void> => {
    const sessionId = stableSessionId(runtime.sessionFile, runtime.cwd);
    const seen = retainedBySession.get(sessionId) ?? new Set<string>();
    const fingerprints = messages.map((message) => messageFingerprint(message as AgentMessage));
    for (const fingerprint of fingerprints) seen.add(fingerprint);
    retainedBySession.set(sessionId, seen);
    await addRetainFingerprints(runtime.cwd, sessionId, fingerprints);
  };

  const retainableMessages = (messages: AgentEndEvent["messages"]): Record<string, unknown>[] =>
    projectMessages(messages as AgentMessage[], deps.getConfig());

  const retainableMessageCount = (messages: AgentEndEvent["messages"]): number =>
    retainableMessages(messages).length;

  const retainTargets = (
    runtime: RuntimeSnapshot,
    messages: AgentEndEvent["messages"],
  ): { targets: string[]; decision?: MemoryRouteDecision } => {
    const config = deps.getConfig();
    if (config.userRetain.mode !== "router") {
      return { targets: config.banks.project.enabled ? [deps.getProjectBankId()] : [] };
    }
    const content = JSON.stringify(retainableMessages(messages), null, 2);
    const decision = routeMemoryCandidate({
      content,
      context: "Automatic retain from Pi agent_end.",
      config,
    });
    const targets = decision.writes.flatMap((target) => {
      if (target === "project" && config.banks.project.enabled) return [deps.getProjectBankId()];
      if (target === "global" && config.banks.user.enabled && config.banks.user.bankId)
        return [config.banks.user.bankId];
      return [];
    });
    return { targets: [...new Set(targets)], decision };
  };

  return {
    async retain(event: AgentEndEvent, runtime: RuntimeSnapshot): Promise<RetainTurnResult> {
      const config = deps.getConfig();
      const canRetainProject = config.banks.project.enabled;
      const canRetainGlobal = config.banks.user.enabled && Boolean(config.banks.user.bankId);
      if (!config.enabled || !config.retain.enabled || (!canRetainProject && !canRetainGlobal))
        return { queued: false, sent: 0, remaining: 0 };

      const sessionMeta = await readSessionMemoryMeta(runtime.cwd, runtime.sessionFile);
      const nextRetainMode = sessionMeta.nextRetainMode;
      const sessionMemory = getEffectiveSessionMemoryMode(sessionMeta);
      if (!sessionMemory.retain || nextRetainMode === "off") {
        try {
          await markRetainedMessages(runtime, event.messages);
        } catch (error) {
          deps.setMemoryStatus(runtime, "retain-failed");
          deps.notify(
            runtime,
            `Hindsight retain cursor update failed: ${(error as Error).message}`,
            "warning",
          );
          return { queued: false, sent: 0, remaining: 0 };
        }
        if (nextRetainMode === "off") {
          await clearNextSessionRetainMode(runtime.cwd, runtime.sessionFile);
          deps.notify(
            runtime,
            "Hindsight skipped retain for this run due to next-opt-out.",
            "info",
          );
        }
        return { queued: false, sent: 0, remaining: 0 };
      }

      const messages = await newRetainMessages(runtime, event.messages);
      const messageCount = retainableMessageCount(messages);
      if (!messageCount) return { queued: false, sent: 0, remaining: 0 };

      try {
        deps.setMemoryStatus(runtime, "retaining");
        const capabilities = deps.getCapabilities();
        const { targets, decision } = retainTargets(runtime, messages);
        if (targets.length === 0) {
          await markRetainedMessages(runtime, messages);
          deps.setMemoryStatus(runtime, "retained", 0);
          if (config.notifications.retain) {
            deps.notify(
              runtime,
              `Hindsight router skipped ${messageCount} new message${messageCount === 1 ? "" : "s"}${decision ? `; ${decision.reason}` : ""}`,
              "info",
            );
          }
          return { queued: false, sent: 0, remaining: 0 };
        }
        let sent = 0;
        let remaining = 0;
        let queued = false;
        for (const bankId of targets) {
          const result = await enqueueRetainFromAgentEnd({
            event: { ...event, messages },
            cwd: runtime.cwd,
            ...(runtime.sessionFile ? { sessionFile: runtime.sessionFile } : {}),
            config,
            client: deps.getClient(),
            bankId,
            ...(capabilities ? { capabilities } : {}),
            extraTags: sessionMemory.tags,
          });
          queued ||= result.queued;
          sent += result.sent;
          remaining = result.remaining;
        }
        if (queued) await markRetainedMessages(runtime, messages);
        deps.setMemoryStatus(runtime, remaining > 0 ? "retain-queued" : "retained", remaining);
        if (config.notifications.retain) {
          deps.notify(
            runtime,
            `Hindsight retained ${messageCount} new message${messageCount === 1 ? "" : "s"} to ${targets.join(", ")}${decision ? `; ${decision.reason}` : ""}${remaining > 0 ? `; ${remaining} queued` : ""}`,
            "info",
          );
        }
        return { queued, sent, remaining };
      } catch (error) {
        deps.setMemoryStatus(runtime, "retain-failed");
        deps.notify(runtime, `Hindsight retain queue failed: ${redactError(error)}`, "warning");
        return { queued: false, sent: 0, remaining: 0 };
      }
    },
  };
}
