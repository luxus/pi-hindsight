import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { recallForContext } from "./recall.js";
import { writeLastRecallSnapshot } from "./recall-visibility.js";
import { selectMemoryScopes } from "./memory-scope.js";
import { getEffectiveSessionMemoryMode, readSessionMemoryMeta } from "./session-memory-meta.js";
import type { HindsightActivity } from "./status.js";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import type { ContextEvent, ContextPatch, RuntimeSnapshot } from "./memory-lifecycle-runtime.js";

export type RecallStatusActivity = Extract<
  HindsightActivity,
  "recalling" | "recalled" | "recall-empty" | "recall-failed"
>;

export interface RecallTurnPolicy {
  recall(event: ContextEvent, runtime: RuntimeSnapshot): Promise<ContextPatch | undefined>;
}

export interface RecallTurnPolicyDeps {
  getConfig(): ResolvedConfig;
  getClient(): HindsightLikeClient;
  setMemoryStatus(
    runtime: RuntimeSnapshot,
    activity: RecallStatusActivity,
    memoryCount?: number,
  ): void;
  notify(runtime: RuntimeSnapshot, message: string, level: "info" | "warning"): void;
}

function canAppendRecallMessage(event: ContextEvent): boolean {
  const last = event.messages[event.messages.length - 1];
  const lastRole = (last as unknown as { role?: string } | undefined)?.role;
  return Boolean(last && lastRole === "user");
}

function buildRecallNotification(memoryCount: number, bankIds: string[], failed: number): string {
  if (memoryCount > 0) {
    return `Hindsight recalled ${memoryCount} memory item${memoryCount === 1 ? "" : "s"} from ${bankIds.join(", ")}${failed > 0 ? `; ${failed} bank${failed === 1 ? "" : "s"} failed` : ""}`;
  }
  if (failed > 0) return `Hindsight recall failed for ${failed} bank${failed === 1 ? "" : "s"}`;
  return "Hindsight recalled no matching memory";
}

function patchWithRecallMessage(
  event: ContextEvent,
  recallMessage: AgentMessage,
): ContextPatch | undefined {
  const last = event.messages[event.messages.length - 1];
  const lastRole = (last as unknown as { role?: string } | undefined)?.role;
  if (last && lastRole === "user") {
    return { messages: [...event.messages.slice(0, -1), recallMessage, last] };
  }
  return undefined;
}

export function createRecallTurnPolicy(deps: RecallTurnPolicyDeps): RecallTurnPolicy {
  return {
    async recall(event: ContextEvent, runtime: RuntimeSnapshot): Promise<ContextPatch | undefined> {
      const config = deps.getConfig();
      if (!config.enabled || !config.recall.enabled) return undefined;

      const sessionMemory = getEffectiveSessionMemoryMode(
        await readSessionMemoryMeta(runtime.cwd, runtime.sessionFile),
      );
      if (!sessionMemory.recall) return undefined;

      const scopes = selectMemoryScopes(runtime.cwd, config);
      if (scopes.length === 0) return undefined;
      if (config.recall.injectionPosition === "append" && !canAppendRecallMessage(event)) {
        return undefined;
      }

      try {
        deps.setMemoryStatus(runtime, "recalling");
        const { rendered, blocks, failed, failures } = await recallForContext({
          client: deps.getClient(),
          config,
          scopes,
          messages: event.messages,
          cwd: runtime.cwd,
        });
        const memoryCount = blocks.reduce((count, block) => count + block.memoryCount, 0);
        deps.setMemoryStatus(
          runtime,
          memoryCount > 0 ? "recalled" : failed > 0 ? "recall-failed" : "recall-empty",
          memoryCount,
        );
        if (config.notifications.recall) {
          deps.notify(
            runtime,
            buildRecallNotification(
              memoryCount,
              blocks.map((block) => block.bankId),
              failed,
            ),
            failed > 0 && memoryCount === 0 ? "warning" : "info",
          );
        }
        if (
          config.recall.storeLastRecall &&
          (rendered || failed === 0 || config.recall.storeLastRecallFailures)
        ) {
          try {
            await writeLastRecallSnapshot(runtime.cwd, config.recall.lastRecallPath, {
              query: blocks[0]?.query ?? failures[0]?.query ?? "",
              rendered,
              blocks,
              failed,
              ...(failures.length ? { failures } : {}),
            });
          } catch (error) {
            deps.notify(
              runtime,
              `Hindsight last recall snapshot write failed: ${(error as Error).message}`,
              "warning",
            );
          }
        }
        if (!rendered) return undefined;
        const recallMessage = {
          role: "user",
          content: rendered,
          timestamp: Date.now(),
        } as AgentMessage;
        if (config.recall.injectionPosition === "append") {
          return patchWithRecallMessage(event, recallMessage);
        }
        return { messages: [recallMessage, ...event.messages] };
      } catch {
        deps.setMemoryStatus(runtime, "recall-failed");
        return undefined;
      }
    },
  };
}
