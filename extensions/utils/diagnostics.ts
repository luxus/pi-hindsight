import type { ResolvedConfig } from "../types.js";
import {
  PI_HINDSIGHT_CLIENT_PACKAGE,
  PI_HINDSIGHT_CLIENT_RANGE,
  PI_HINDSIGHT_SUPPORTED_NODE,
  PI_HINDSIGHT_SUPPORTED_NPM,
  PI_HINDSIGHT_SUPPORTED_TYPEBOX,
  PI_HINDSIGHT_USER_AGENT,
  PI_HINDSIGHT_VERSION,
} from "../version.js";
import { baseTags, findRepoRoot } from "../banks/banking.js";
import { stableSessionId } from "./session.js";
import { createMemoryIdentity } from "../operations/memory-identity.js";
import { expandObservationScopes } from "../lifecycle/observation-scopes.js";
import type { ImportManifestEntry } from "../imports/import-plan.js";
import {
  formatHindsightActivity,
  formatHindsightStatus,
  type HindsightActivity,
} from "./status.js";

export interface DebugReportArgs {
  cwd: string;
  sessionFile?: string;
  projectBankId: string;
  config: ResolvedConfig;
  queueLength: number;
  queuePath?: string;
  queueMalformedLines?: number;
  queueReadError?: string | null;
  deadLetterPath?: string;
  deadLetterLength?: number;
  deadLetterMalformedLines?: number;
  deadLetterReadError?: string | null;
  importManifestPath?: string;
  importManifestError?: string | null;
  importManifestAction?: string | null;
  importCount?: number;
  latestImport?: ImportManifestEntry;
  health?: { ok: boolean; error?: string };
  activity?: HindsightActivity;
  memoryCount?: number;
  queueRemaining?: number;
}

export function bankSelectionMessage(projectBankId: string, config: ResolvedConfig): string {
  if (!config.banks.project.enabled) {
    return config.banks.user.enabled && config.banks.user.bankId
      ? `Hindsight global-only memory: ${config.banks.user.bankId}`
      : "Hindsight project bank disabled and no global bank configured.";
  }
  if (config.banks.project.bankId) {
    return `Hindsight bank configured: ${projectBankId}`;
  }
  return `Hindsight bank auto-selected: ${projectBankId}. Override with PI_HINDSIGHT_PROJECT_BANK_ID or .pi/hindsight.json banks.project.bankId.`;
}

export function memoryProfile(
  config: ResolvedConfig,
): "project-only" | "project+global" | "global-only" | "none" {
  if (!config.banks.project.enabled) return config.banks.user.enabled ? "global-only" : "none";
  if (config.banks.user.enabled) return "project+global";
  return "project-only";
}

export function safeConfig(config: ResolvedConfig): ResolvedConfig {
  return {
    ...config,
    hindsight: {
      ...config.hindsight,
      ...(config.hindsight.apiKey ? { apiKey: "[set]" } : {}),
      ...(config.hindsight.apiKeyRef ? { apiKeyRef: config.hindsight.apiKeyRef } : {}),
    },
  };
}

export function observationScopeDiagnostics(args: {
  cwd: string;
  sessionFile?: string;
  projectBankId: string;
  config: ResolvedConfig;
}): { enabled: boolean; scopes: string[][] | null; error: string | null; action: string | null } {
  const identity = {
    ...createMemoryIdentity(args.cwd, args.config, args.sessionFile),
    projectBankId: args.projectBankId,
  };
  try {
    return {
      enabled: args.config.observations.enabled,
      scopes: args.config.observations.enabled
        ? expandObservationScopes(args.config.observations.scopes, identity)
        : [],
      error: null,
      action: null,
    };
  } catch (error) {
    return {
      enabled: args.config.observations.enabled,
      scopes: null,
      error: error instanceof Error ? error.message : String(error),
      action: "Fix observations.scopes placeholders or disable observations.enabled.",
    };
  }
}

export function formatDebugReport(args: DebugReportArgs): string {
  const sessionId = stableSessionId(args.sessionFile, args.cwd);
  const tags = baseTags(args.cwd, sessionId);
  const observationScopes = observationScopeDiagnostics(args);
  const health = args.health
    ? args.health.ok
      ? "reachable"
      : `unreachable: ${args.health.error}`
    : "not checked";
  const activity = args.activity ?? "idle";
  return JSON.stringify(
    {
      enabled: args.config.enabled,
      integration: {
        packageVersion: PI_HINDSIGHT_VERSION,
        userAgent: PI_HINDSIGHT_USER_AGENT,
        hindsightBaseUrl: args.config.hindsight.baseUrl,
        clientPackage: PI_HINDSIGHT_CLIENT_PACKAGE,
        clientRange: PI_HINDSIGHT_CLIENT_RANGE,
        compatibility: {
          node: PI_HINDSIGHT_SUPPORTED_NODE,
          npm: PI_HINDSIGHT_SUPPORTED_NPM,
          typebox: PI_HINDSIGHT_SUPPORTED_TYPEBOX,
          hindsightServer:
            "Hindsight 0.8+ with append update_mode support; advanced tools are capability-gated.",
          policy: "Pi-first 1.0 integration; global platform admin parity is out of scope.",
        },
      },
      health,
      cwd: args.cwd,
      repoRoot: findRepoRoot(args.cwd),
      sessionFile: args.sessionFile ?? null,
      sessionId,
      memoryProfile: memoryProfile(args.config),
      projectBankId: args.projectBankId,
      projectBankSelection: args.config.banks.project.bankId
        ? "configured"
        : args.config.banks.project.derive,
      bankMissions: {
        projectConfigured: Boolean(
          args.config.banks.project.retainMission ||
          args.config.banks.project.reflectMission ||
          args.config.banks.project.observationsMission,
        ),
        globalConfigured: Boolean(
          args.config.banks.user.retainMission ||
          args.config.banks.user.reflectMission ||
          args.config.banks.user.observationsMission,
        ),
      },
      observations: observationScopes,
      overrideProjectBankId:
        "Set PI_HINDSIGHT_PROJECT_BANK_ID or .pi/hindsight.json banks.project.bankId",
      globalBankId: args.config.banks.user.enabled ? (args.config.banks.user.bankId ?? null) : null,
      memoryRoutes: {
        recall: [
          ...(args.config.banks.project.enabled ? ["project"] : []),
          ...(args.config.banks.user.enabled && args.config.banks.user.bankId ? ["global"] : []),
        ],
        autoRetain: args.config.banks.project.enabled ? "project" : null,
      },
      tags,
      queuePath: args.config.retain.queuePath,
      queueLength: args.queueLength,
      queue: {
        path: args.queuePath ?? args.config.retain.queuePath,
        active: args.queueLength,
        malformedLines: args.queueMalformedLines ?? 0,
        error: args.queueReadError ?? null,
        deadLetterPath: args.deadLetterPath ?? null,
        deadLetter: args.deadLetterLength ?? 0,
        deadLetterMalformedLines: args.deadLetterMalformedLines ?? 0,
        deadLetterError: args.deadLetterReadError ?? null,
        action:
          args.queueReadError ||
          args.deadLetterReadError ||
          (args.queueMalformedLines ?? 0) > 0 ||
          (args.deadLetterMalformedLines ?? 0) > 0 ||
          (args.deadLetterLength ?? 0) > 0
            ? "Inspect queue files, fix malformed JSONL offline if needed, then open /hindsight and press f to flush after Hindsight is reachable."
            : null,
      },
      serverRequirements: {
        appendUpdateMode: "required (Hindsight 0.8+)",
        clientPackage: PI_HINDSIGHT_CLIENT_PACKAGE,
        clientRange: PI_HINDSIGHT_CLIENT_RANGE,
        action: "Upgrade to Hindsight 0.8+ if live append retain fails.",
      },
      imports: {
        manifestPath: args.importManifestPath ?? args.config.import.manifestPath,
        error: args.importManifestError ?? null,
        action: args.importManifestError
          ? (args.importManifestAction ??
            "Move or repair the import manifest, then open /hindsight and press i to re-run import.")
          : null,
        count: args.importCount ?? 0,
        latest: args.latestImport
          ? {
              documentId: args.latestImport.documentId,
              sourceFile: args.latestImport.sourceFile,
              importedAt: args.latestImport.importedAt,
              messageCount: args.latestImport.messageCount,
              leafId: args.latestImport.leafId,
              sessionId: args.latestImport.sessionId,
              contentHash: args.latestImport.contentHash,
              ...(args.latestImport.importMode ? { importMode: args.latestImport.importMode } : {}),
              ...(args.latestImport.toolResults
                ? { toolResults: args.latestImport.toolResults }
                : {}),
              ...(args.latestImport.importQualityProfile
                ? { importQualityProfile: args.latestImport.importQualityProfile }
                : {}),
              ...(args.latestImport.projectionVersion
                ? { projectionVersion: args.latestImport.projectionVersion }
                : {}),
              ...(args.latestImport.importProfile
                ? { importProfile: args.latestImport.importProfile }
                : {}),
              ...(args.latestImport.chunkIndex !== undefined
                ? { chunkIndex: args.latestImport.chunkIndex }
                : {}),
              ...(args.latestImport.messageRange
                ? { messageRange: args.latestImport.messageRange }
                : {}),
              ...(args.latestImport.updateMode ? { updateMode: args.latestImport.updateMode } : {}),
            }
          : null,
      },
      status: args.config.status,
      statusPreview:
        formatHindsightStatus(args.config, {
          cwd: args.cwd,
          projectBankId: args.projectBankId,
          activity,
          ...(args.memoryCount !== undefined ? { memoryCount: args.memoryCount } : {}),
          ...(args.queueRemaining !== undefined ? { queueRemaining: args.queueRemaining } : {}),
        }) ?? null,
      activity: formatHindsightActivity(activity, args.memoryCount, args.queueRemaining),
      recall: {
        enabled: args.config.recall.enabled,
        budget: args.config.recall.budget,
        maxTokens: args.config.recall.maxTokens,
        types: args.config.recall.types,
        contextTurns: args.config.recall.contextTurns,
        roles: args.config.recall.roles,
        maxQueryChars: args.config.recall.maxQueryChars,
        queryPreamble: args.config.recall.queryPreamble,
        projectQueryPreamble: args.config.recall.projectQueryPreamble,
        globalQueryPreamble: args.config.recall.globalQueryPreamble,
        includeDateInQuery: args.config.recall.includeDateInQuery,
        includeRepoHintsInQuery: args.config.recall.includeRepoHintsInQuery,
        storeLastRecall: args.config.recall.storeLastRecall,
        storeLastRecallFailures: args.config.recall.storeLastRecallFailures,
        lastRecallPath: args.config.recall.lastRecallPath,
        topK: args.config.recall.topK,
        timeoutMs: args.config.recall.timeoutMs,
        injectionPosition: args.config.recall.injectionPosition,
        minScores: args.config.recall.minScores,
      },
      retain: {
        enabled: args.config.retain.enabled,
        async: args.config.retain.async,
        updateMode: args.config.retain.updateMode,
        redactSecrets: args.config.retain.redactSecrets,
        content: args.config.retain.content,
        toolFilter: args.config.retain.toolFilter,
        strip: args.config.retain.strip,
      },
      config: safeConfig(args.config),
    },
    null,
    2,
  );
}
