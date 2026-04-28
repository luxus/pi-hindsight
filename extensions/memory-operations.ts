import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { HindsightCapabilities, HindsightLikeClient, ResolvedConfig } from "./types.js";
import { checkHindsight } from "./client.js";
import { flushRetainQueue, resolveQueuePath, summarizeRetainQueue } from "./queue.js";
import { formatDebugReport, observationScopeDiagnostics, safeConfig } from "./diagnostics.js";
import {
  buildProjectConfigPatch,
  writeProjectConfig,
  type ProjectConfigPatchInput,
} from "./config-writer.js";
import { importPiSession, importProjectSessions } from "./import-sessions.js";
import {
  importManifestSummary,
  readImportManifest,
  resolveImportManifestPath,
} from "./import-manifest.js";
import { recallScopeTags } from "./banking.js";
import { stableSessionId } from "./session.js";
import { createMemoryIdentity, explicitRetainTags } from "./memory-identity.js";
import { expandObservationScopes } from "./observation-scopes.js";
import { retainDurably } from "./retain-durable.js";
import { readLastRecallSnapshot, resolveLastRecallPath } from "./recall-visibility.js";
import { pruneTranscriptRecallBlocks, scanTranscriptForRecallBlocks } from "./recall-cleanup.js";
import {
  addSessionMemoryTag,
  getEffectiveSessionMemoryMode,
  readSessionMemoryMeta,
  removeSessionMemoryTag,
  setSessionMemoryMode,
  setSessionRetainEnabled,
  type SessionMemoryMode,
} from "./session-memory-meta.js";

export interface MemoryOperationsDeps {
  getClient(): HindsightLikeClient;
  getConfig(): ResolvedConfig;
  getProjectBankId(): string;
  getCapabilities?(): HindsightCapabilities | undefined;
  reloadConfig?(cwd: string): void;
}

export type ConfigureMemoryArgs = ProjectConfigPatchInput;

function recallTagsForBank(
  cwd: string,
  config: ResolvedConfig,
  projectBankId: string,
  bankId: string,
): string[] {
  return config.banks.global.enabled && bankId === config.banks.global.bankId
    ? ["source:pi"]
    : recallScopeTags(cwd);
}

export function createMemoryOperations(deps: MemoryOperationsDeps) {
  return {
    async recall(cwd: string, query: string, bank?: string, sessionFile?: string) {
      const meta = await readSessionMemoryMeta(cwd, sessionFile);
      if (!getEffectiveSessionMemoryMode(meta).recall)
        throw new Error("Hindsight recall is disabled for this session");
      const config = deps.getConfig();
      const bankId = bank || deps.getProjectBankId();
      const result = await deps.getClient().recall(bankId, query, {
        budget: config.recall.budget,
        maxTokens: config.recall.maxTokens,
        tags: recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId),
        tagsMatch: "any_strict",
      });
      return { bankId, result };
    },

    async retainExplicit(args: {
      cwd: string;
      sessionFile?: string;
      content: string;
      context: string;
      bank?: string;
      tags?: string[];
    }) {
      const meta = await readSessionMemoryMeta(args.cwd, args.sessionFile);
      if (!getEffectiveSessionMemoryMode(meta).retain)
        throw new Error("Hindsight retain is disabled for this session");
      const config = deps.getConfig();
      const bankId = args.bank || deps.getProjectBankId();
      const tags = explicitRetainTags(args.cwd, args.sessionFile, [
        ...(args.tags ?? []),
        ...meta.tags,
      ]);
      const capabilities = deps.getCapabilities?.();
      const identity = createMemoryIdentity(args.cwd, config, args.sessionFile);
      const observationScopes = config.observations.enabled
        ? expandObservationScopes(config.observations.scopes, {
            ...identity,
            projectBankId: bankId,
          })
        : [];
      const result = await retainDurably({
        cwd: args.cwd,
        config,
        client: deps.getClient(),
        bankId,
        content: args.content,
        context: args.context,
        tags,
        updateMode: "append",
        documentId: `pi-explicit:${stableSessionId(args.sessionFile, args.cwd)}`,
        metadata: {
          cwd: args.cwd,
          ...(args.sessionFile ? { pi_session_file: args.sessionFile } : {}),
        },
        source: "tool",
        ...(observationScopes.length ? { observationScopes } : {}),
        ...(capabilities ? { capabilities } : {}),
      });
      return { bankId, tags, ...result, queued: result.enqueued };
    },

    async configure(cwd: string, args: ConfigureMemoryArgs) {
      const projectBankId = args.projectBankId || deps.getProjectBankId();
      const patch = buildProjectConfigPatch(args);
      const result = await writeProjectConfig(cwd, patch);
      deps.reloadConfig?.(cwd);
      return { ...result, projectBankId };
    },

    async importSession(args: {
      sessionFile: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
    }) {
      const bankId = args.bank || deps.getProjectBankId();
      const result = await importPiSession({
        sessionFile: args.sessionFile,
        bankId,
        client: deps.getClient(),
        config: deps.getConfig(),
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
      });
      return { bankId, ...result };
    },

    async importProjectSessions(args: {
      cwd: string;
      currentSessionFile?: string;
      searchDir?: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
    }) {
      const bankId = args.bank || deps.getProjectBankId();
      const result = await importProjectSessions({
        cwd: args.cwd,
        ...(args.currentSessionFile ? { currentSessionFile: args.currentSessionFile } : {}),
        ...(args.searchDir ? { searchDir: args.searchDir } : {}),
        bankId,
        client: deps.getClient(),
        config: deps.getConfig(),
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
      });
      return { bankId, ...result };
    },

    async reflect(cwd: string, query: string, context?: string, bank?: string) {
      const config = deps.getConfig();
      const bankId = bank || deps.getProjectBankId();
      const result = await deps.getClient().reflect(bankId, query, {
        ...(context ? { context } : {}),
        budget: config.recall.budget,
        tags: recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId),
        tagsMatch: "any_strict",
      });
      return { bankId, result };
    },

    async status(cwd: string) {
      const config = deps.getConfig();
      const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
      const [queue, manifest] = await Promise.all([
        summarizeRetainQueue(queuePath),
        readImportManifest(resolveImportManifestPath(cwd, config.import.manifestPath)),
      ]);
      return {
        config,
        bankId: deps.getProjectBankId(),
        queueLength: queue.active.valid,
        queue,
        imports: importManifestSummary(manifest),
      };
    },

    async doctor(cwd: string) {
      const config = deps.getConfig();
      const queuePath = resolveQueuePath(cwd, config.retain.queuePath);
      const [health, queue, manifest] = await Promise.all([
        checkHindsight(deps.getClient(), deps.getProjectBankId()),
        summarizeRetainQueue(queuePath),
        readImportManifest(resolveImportManifestPath(cwd, config.import.manifestPath)),
      ]);
      return {
        health,
        ...(deps.getCapabilities?.() ? { capabilities: deps.getCapabilities() } : {}),
        queueLength: queue.active.valid,
        queue,
        imports: importManifestSummary(manifest),
        observations: observationScopeDiagnostics({
          cwd,
          projectBankId: deps.getProjectBankId(),
          config,
        }),
      };
    },

    config() {
      return safeConfig(deps.getConfig());
    },

    async debug(ctx: ExtensionCommandContext) {
      const config = deps.getConfig();
      const queuePath = resolveQueuePath(ctx.cwd, config.retain.queuePath);
      const [queue, health] = await Promise.all([
        summarizeRetainQueue(queuePath),
        checkHindsight(deps.getClient(), deps.getProjectBankId()),
      ]);
      const manifestPath = resolveImportManifestPath(ctx.cwd, config.import.manifestPath);
      const manifest = await readImportManifest(manifestPath);
      const imports = importManifestSummary(manifest);
      const sessionFile = ctx.sessionManager.getSessionFile?.();
      const capabilities = deps.getCapabilities?.();
      return {
        health,
        report: formatDebugReport({
          cwd: ctx.cwd,
          ...(sessionFile ? { sessionFile } : {}),
          projectBankId: deps.getProjectBankId(),
          config,
          queueLength: queue.active.valid,
          queuePath: queue.active.path,
          queueMalformedLines: queue.active.malformed,
          queueReadError: queue.active.error,
          deadLetterPath: queue.deadLetter.path,
          deadLetterLength: queue.deadLetter.valid,
          deadLetterMalformedLines: queue.deadLetter.malformed,
          deadLetterReadError: queue.deadLetter.error,
          importManifestPath: manifestPath,
          importCount: imports.count,
          ...(imports.latest ? { latestImport: imports.latest } : {}),
          health,
          ...(capabilities ? { capabilities } : {}),
        }),
      };
    },

    async init(cwd: string) {
      const result = await writeProjectConfig(
        cwd,
        buildProjectConfigPatch({
          projectBankId: deps.getProjectBankId(),
          baseUrl: deps.getConfig().hindsight.baseUrl,
        }),
      );
      deps.reloadConfig?.(cwd);
      return { ...result, projectBankId: deps.getProjectBankId() };
    },

    async session(cwd: string, sessionFile?: string) {
      const meta = await readSessionMemoryMeta(cwd, sessionFile);
      return { meta, effective: getEffectiveSessionMemoryMode(meta) };
    },

    async setSessionMode(cwd: string, sessionFile: string | undefined, mode: SessionMemoryMode) {
      const meta = await setSessionMemoryMode(cwd, sessionFile, mode);
      return { meta, effective: getEffectiveSessionMemoryMode(meta) };
    },

    async setSessionRetain(cwd: string, sessionFile: string | undefined, enabled: boolean) {
      const meta = await setSessionRetainEnabled(cwd, sessionFile, enabled);
      return { meta, effective: getEffectiveSessionMemoryMode(meta) };
    },

    async addSessionTag(cwd: string, sessionFile: string | undefined, tag: string) {
      const meta = await addSessionMemoryTag(cwd, sessionFile, tag);
      return { meta, effective: getEffectiveSessionMemoryMode(meta) };
    },

    async removeSessionTag(cwd: string, sessionFile: string | undefined, tag: string) {
      const meta = await removeSessionMemoryTag(cwd, sessionFile, tag);
      return { meta, effective: getEffectiveSessionMemoryMode(meta) };
    },

    async lastRecall(cwd: string) {
      const config = deps.getConfig();
      const path = resolveLastRecallPath(cwd, config.recall.lastRecallPath);
      const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
      return { path, snapshot };
    },

    async recallCleanup(sessionFile: string, prune: boolean) {
      return prune
        ? pruneTranscriptRecallBlocks(sessionFile)
        : scanTranscriptForRecallBlocks(sessionFile);
    },

    async flush(cwd: string) {
      return flushRetainQueue(
        resolveQueuePath(cwd, deps.getConfig().retain.queuePath),
        deps.getClient(),
      );
    },
  };
}

export type MemoryOperations = ReturnType<typeof createMemoryOperations>;
