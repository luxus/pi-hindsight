import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "../config/config.js";
import { consumeLastConfigMigrationResults } from "../config/config.js";
import { isMemorySetupComplete, setupRequiredMessage } from "../config/setup-gate.js";
import { deriveProjectBankId } from "../banks/banking.js";
import { createHindsightClient } from "../client/client.js";
import { ensureGlobalBank, ensureProjectBank } from "../banks/bank-operations.js";
import { flushRetainQueue, retainQueuePath } from "../queue/queue.js";
import { recordRetainDeliveries } from "./retain.js";
import { formatFlushRetainQueueResult } from "../queue/flush-presenter.js";
import { bankSelectionMessage } from "../utils/diagnostics.js";
import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { redactError } from "../utils/sanitize.js";
import {
  notify,
  setMemoryStatus as setRuntimeMemoryStatus,
  snapshotRuntime,
  type ContextEvent,
  type ContextPatch,
  type RuntimeCtx,
  type RuntimeSnapshot,
} from "./memory-lifecycle-runtime.js";
import { createRetainTurnPolicy } from "./memory-lifecycle-retain.js";
import { createRecallTurnPolicy } from "./memory-lifecycle-recall.js";

export interface InitHealthFailure {
  subsystem: "project-bank" | "user-bank";
  error: string;
}

export interface InitHealth {
  checkedAt: string;
  failures: InitHealthFailure[];
}

export interface MemoryLifecycleDeps {
  getClient(): HindsightLikeClient;
  getConfig(): ResolvedConfig;
  getProjectBankId(): string;
  getInitHealth(): InitHealth | undefined;
  reloadConfig(cwd: string): void;
}

export interface MemoryLifecycle {
  deps: MemoryLifecycleDeps;
  initialize(ctx: RuntimeCtx): Promise<void>;
  recall(event: ContextEvent, ctx: RuntimeCtx): Promise<ContextPatch | undefined>;
  retain(
    event: AgentEndEvent,
    ctx: RuntimeCtx,
  ): Promise<{ queued: boolean; sent: number; remaining: number }>;
  shutdown(ctx: RuntimeCtx): Promise<void>;
}

export function createMemoryLifecycle(initialCwd: string = process.cwd()): MemoryLifecycle {
  let config: ResolvedConfig = resolveConfig(initialCwd);
  let client: HindsightLikeClient = createHindsightClient(config);
  let projectBankId = deriveProjectBankId(initialCwd, config);
  let initHealth: InitHealth | undefined;
  let periodicFlush: NodeJS.Timeout | undefined;
  let periodicFlushActive = false;
  const stopPeriodicFlush = () => {
    if (!periodicFlush) return;
    clearInterval(periodicFlush);
    periodicFlush = undefined;
  };

  const reloadConfig = (cwd: string) => {
    stopPeriodicFlush();
    config = resolveConfig(cwd);
    client = createHindsightClient(config);
    projectBankId = deriveProjectBankId(cwd, config);
  };

  const startPeriodicFlush = (runtime: RuntimeSnapshot) => {
    stopPeriodicFlush();
    if (!config.enabled || !config.retain.enabled || config.retain.flushIntervalMs <= 0) return;
    if (!isMemorySetupComplete(config, runtime.cwd)) return;
    const queuePath = retainQueuePath(runtime.cwd, config);
    periodicFlush = setInterval(() => {
      if (periodicFlushActive) return;
      periodicFlushActive = true;
      void flushRetainQueue(queuePath, client, {
        stopOnFirstFailure: true,
        maxJobs: config.retain.periodicFlushMaxJobs,
        maxElapsedMs: config.retain.periodicFlushTimeoutMs,
      })
        .then(async (result) => {
          await recordRetainDeliveries(runtime.cwd, config, result);
          if (result.deadLettered || result.remaining) {
            notify(runtime, formatFlushRetainQueueResult(result), "warning");
          }
        })
        .catch((error) => {
          notify(runtime, `Periodic retain queue flush failed: ${redactError(error)}`, "warning");
        })
        .finally(() => {
          periodicFlushActive = false;
        });
    }, config.retain.flushIntervalMs);
    periodicFlush.unref?.();
  };

  const setMemoryStatus = (
    runtime: RuntimeSnapshot,
    activity: Parameters<typeof setRuntimeMemoryStatus>[0]["activity"],
    memoryCount?: number,
    queueRemaining?: number,
  ) =>
    setRuntimeMemoryStatus({
      runtime,
      config,
      projectBankId,
      activity,
      ...(memoryCount !== undefined ? { memoryCount } : {}),
      ...(queueRemaining !== undefined ? { queueRemaining } : {}),
    });

  const deps: MemoryLifecycleDeps = {
    getClient: () => client,
    getConfig: () => config,
    getProjectBankId: () => projectBankId,
    getInitHealth: () => initHealth,
    reloadConfig,
  };

  const retainPolicy = createRetainTurnPolicy({
    getConfig: () => config,
    getClient: () => client,
    getProjectBankId: () => projectBankId,
    setMemoryStatus: (runtime, activity, queueRemaining) =>
      setMemoryStatus(runtime, activity, undefined, queueRemaining),
    notify,
  });

  const recallPolicy = createRecallTurnPolicy({
    getConfig: () => config,
    getClient: () => client,
    setMemoryStatus: (runtime, activity, memoryCount) =>
      setMemoryStatus(runtime, activity, memoryCount),
    notify,
  });

  return {
    deps,

    async initialize(ctx: RuntimeCtx): Promise<void> {
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return;
      reloadConfig(runtime.cwd);
      const migrations = consumeLastConfigMigrationResults();
      if (migrations.length) {
        notify(
          runtime,
          `Migrated Hindsight memory config from global to user keys. Backups: ${migrations
            .map((migration) => migration.backupPath)
            .join(", ")}`,
          "info",
        );
      }
      if (!config.enabled) {
        // Clear status bar when extension is disabled for this repo.
        try {
          runtime.ui.setStatus("hindsight", undefined);
        } catch {
          // Session ctx can go stale; status clear is best effort.
        }
        return;
      }
      if (!isMemorySetupComplete(config, runtime.cwd)) {
        initHealth = { checkedAt: new Date().toISOString(), failures: [] };
        setMemoryStatus(runtime, "idle");
        if (config.notifications.startup) notify(runtime, setupRequiredMessage(), "warning");
        return;
      }
      const failures: InitHealthFailure[] = [];
      let ensureSucceeded = false;
      if (config.banks.project.enabled) {
        try {
          await ensureProjectBank(client, projectBankId, {
            ...config.banks.project,
            enableObservations: config.observations.enabled,
          });
          ensureSucceeded = true;
        } catch (error) {
          failures.push({ subsystem: "project-bank", error: redactError(error) });
          setMemoryStatus(runtime, "offline");
          notify(runtime, `Hindsight project bank ensure failed: ${redactError(error)}`, "warning");
        }
      }
      if (config.banks.user.enabled && config.banks.user.bankId) {
        try {
          await ensureGlobalBank(client, config.banks.user.bankId, {
            ...config.banks.user,
            enableObservations: config.observations.enabled,
            agentUse: config.agentUse,
          });
          ensureSucceeded = true;
        } catch (error) {
          failures.push({ subsystem: "user-bank", error: redactError(error) });
          setMemoryStatus(runtime, "offline");
          notify(runtime, `Hindsight global bank ensure failed: ${redactError(error)}`, "warning");
        }
      }
      initHealth = { checkedAt: new Date().toISOString(), failures };
      startPeriodicFlush(runtime);
      setMemoryStatus(
        runtime,
        failures.length ? "offline" : ensureSucceeded ? "connected" : "idle",
      );
      if (config.notifications.startup)
        notify(runtime, bankSelectionMessage(projectBankId, config), "info");
    },

    async recall(event: ContextEvent, ctx: RuntimeCtx): Promise<ContextPatch | undefined> {
      if (!config.enabled || !config.recall.enabled) return undefined;
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return undefined;
      if (!isMemorySetupComplete(config, runtime.cwd)) return undefined;
      return recallPolicy.recall(event, runtime);
    },

    async retain(
      event: AgentEndEvent,
      ctx: RuntimeCtx,
    ): Promise<{ queued: boolean; sent: number; remaining: number }> {
      const canRetainProject = config.banks.project.enabled;
      const canRetainUser = config.banks.user.enabled && Boolean(config.banks.user.bankId);
      if (!config.enabled || !config.retain.enabled || (!canRetainProject && !canRetainUser))
        return { queued: false, sent: 0, remaining: 0 };
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return { queued: false, sent: 0, remaining: 0 };
      if (!isMemorySetupComplete(config, runtime.cwd))
        return { queued: false, sent: 0, remaining: 0 };
      return retainPolicy.retain(event, runtime);
    },

    async shutdown(ctx: RuntimeCtx): Promise<void> {
      stopPeriodicFlush();
      if (!config.enabled || !config.retain.enabled) return;
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return;
      if (!isMemorySetupComplete(config, runtime.cwd)) return;
      try {
        const result = await flushRetainQueue(retainQueuePath(runtime.cwd, config), client, {
          maxJobs: config.retain.shutdownFlushMaxJobs,
          maxElapsedMs: config.retain.shutdownFlushTimeoutMs,
          stopOnFirstFailure: true,
        });
        await recordRetainDeliveries(runtime.cwd, config, result);
        if (result.deadLettered || result.remaining) {
          notify(runtime, formatFlushRetainQueueResult(result), "warning");
        }
      } catch (error) {
        notify(runtime, `Shutdown retain queue flush failed: ${redactError(error)}`, "warning");
        // Keep queue on disk for next run.
      }
    },
  };
}
