import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "./config.js";
import { consumeLastConfigMigrationResults } from "./config-migration.js";
import { deriveProjectBankId } from "./banking.js";
import { createHindsightClient } from "./client.js";
import { ensureGlobalBank, ensureProjectBank } from "./bank-operations.js";
import { detectAppendCapability } from "./capabilities.js";
import { flushRetainQueue, resolveQueuePath } from "./queue.js";
import { bankSelectionMessage } from "./diagnostics.js";
import type { HindsightCapabilities, HindsightLikeClient, ResolvedConfig } from "./types.js";
import { redactError } from "./sanitize.js";
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

export interface MemoryLifecycleDeps {
  getClient(): HindsightLikeClient;
  getConfig(): ResolvedConfig;
  getProjectBankId(): string;
  getCapabilities(): HindsightCapabilities | undefined;
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
  let capabilities: HindsightCapabilities | undefined;
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
    capabilities = undefined;
  };

  const startPeriodicFlush = (runtime: RuntimeSnapshot) => {
    stopPeriodicFlush();
    if (!config.enabled || !config.retain.enabled || config.retain.flushIntervalMs <= 0) return;
    const queuePath = resolveQueuePath(runtime.cwd, config.retain.queuePath);
    periodicFlush = setInterval(() => {
      if (periodicFlushActive) return;
      periodicFlushActive = true;
      void flushRetainQueue(queuePath, client, {
        stopOnFirstFailure: true,
        maxJobs: config.retain.periodicFlushMaxJobs,
        maxElapsedMs: config.retain.periodicFlushTimeoutMs,
      })
        .catch(() => undefined)
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
    getCapabilities: () => capabilities,
    reloadConfig,
  };

  const retainPolicy = createRetainTurnPolicy({
    getConfig: () => config,
    getClient: () => client,
    getProjectBankId: () => projectBankId,
    getCapabilities: () => capabilities,
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
      if (!config.enabled) return;
      let ensureFailed = false;
      let ensureSucceeded = false;
      if (config.banks.project.enabled) {
        try {
          await ensureProjectBank(client, projectBankId, {
            ...config.banks.project,
            enableObservations: config.observations.enabled,
          });
          ensureSucceeded = true;
        } catch (error) {
          ensureFailed = true;
          setMemoryStatus(runtime, "offline");
          notify(runtime, `Hindsight project bank ensure failed: ${redactError(error)}`, "warning");
        }
      }
      if (config.banks.user.enabled && config.banks.user.bankId) {
        try {
          await ensureGlobalBank(client, config.banks.user.bankId, {
            ...config.banks.user,
            enableObservations: config.observations.enabled,
          });
          ensureSucceeded = true;
        } catch (error) {
          ensureFailed = true;
          setMemoryStatus(runtime, "offline");
          notify(runtime, `Hindsight global bank ensure failed: ${redactError(error)}`, "warning");
        }
      }
      const capabilityProbeBankId = config.banks.project.enabled
        ? projectBankId
        : config.banks.user.enabled
          ? config.banks.user.bankId
          : undefined;
      if (config.retain.enabled && capabilityProbeBankId) {
        try {
          capabilities = await detectAppendCapability(client, capabilityProbeBankId);
        } catch (error) {
          ensureFailed = true;
          setMemoryStatus(runtime, "offline");
          notify(runtime, `Hindsight capability check failed: ${redactError(error)}`, "warning");
        }
      }
      startPeriodicFlush(runtime);
      setMemoryStatus(runtime, ensureFailed ? "offline" : ensureSucceeded ? "connected" : "idle");
      if (config.notifications.startup)
        notify(runtime, bankSelectionMessage(projectBankId, config), "info");
    },

    async recall(event: ContextEvent, ctx: RuntimeCtx): Promise<ContextPatch | undefined> {
      if (!config.enabled || !config.recall.enabled) return undefined;
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return undefined;
      return recallPolicy.recall(event, runtime);
    },

    async retain(
      event: AgentEndEvent,
      ctx: RuntimeCtx,
    ): Promise<{ queued: boolean; sent: number; remaining: number }> {
      if (!config.enabled || !config.retain.enabled || !config.banks.project.enabled)
        return { queued: false, sent: 0, remaining: 0 };
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return { queued: false, sent: 0, remaining: 0 };
      return retainPolicy.retain(event, runtime);
    },

    async shutdown(ctx: RuntimeCtx): Promise<void> {
      stopPeriodicFlush();
      if (!config.enabled || !config.retain.enabled) return;
      const runtime = snapshotRuntime(ctx);
      if (!runtime) return;
      try {
        await flushRetainQueue(resolveQueuePath(runtime.cwd, config.retain.queuePath), client, {
          maxJobs: config.retain.shutdownFlushMaxJobs,
          maxElapsedMs: config.retain.shutdownFlushTimeoutMs,
          stopOnFirstFailure: true,
        });
      } catch {
        // Keep queue on disk for next run.
      }
    },
  };
}
