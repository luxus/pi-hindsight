import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./types.js";

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  hindsight: { baseUrl: "http://localhost:8888", timeoutMs: 30_000 },
  banks: {
    project: { enabled: true, derive: "repo" },
    global: { enabled: false },
  },
  recall: {
    enabled: true,
    budget: "mid",
    maxTokens: 800,
    types: ["observation"],
    contextTurns: 2,
    roles: ["user", "assistant"],
    maxQueryChars: 800,
    queryPreamble: "Pi coding task memory lookup.",
    projectQueryPreamble:
      "Project memory lookup for current repo architecture, tasks, bugs, decisions, and constraints.",
    globalQueryPreamble:
      "Global memory lookup for durable user preferences, recurring workflows, coding habits, and cross-project context.",
    includeDateInQuery: false,
    includeRepoHintsInQuery: true,
    storeLastRecall: false,
    lastRecallPath: ".pi/hindsight/last-recall.json",
    topK: 8,
    timeoutMs: 10_000,
    injectionMode: "context",
    injectionPosition: "append",
    includeFactsInDebug: false,
  },
  observations: {
    enabled: true,
    scopes: [["harness:pi"], ["repo:{repoKey}"]],
  },
  retain: {
    enabled: true,
    async: true,
    updateMode: "append",
    appendFallback: "error",
    content: {
      user: ["text"],
      assistant: ["text", "toolCall"],
      toolResult: ["error"],
    },
    toolFilter: {
      toolCall: { exclude: ["hindsight_retain", "hindsight_recall", "hindsight_reflect"] },
      toolResult: {
        exclude: [
          "hindsight_retain",
          "hindsight_recall",
          "hindsight_reflect",
          "read",
          "grep",
          "find",
          "find_files",
          "ls",
        ],
      },
    },
    strip: { message: ["usage", "cost", "responseId"], topLevel: ["id", "parentId"] },
    redactSecrets: true,
    queuePath: ".pi/hindsight/retain-queue.jsonl",
    shutdownFlushMaxJobs: 10,
    shutdownFlushTimeoutMs: 2_000,
  },
  import: {
    includeBranches: "current-only",
    replaceExistingImportedDocs: true,
    manifestPath: ".pi/hindsight/import-manifest.json",
    checkpointPath: ".pi/hindsight/import-checkpoint.json",
    resume: true,
  },
  status: {
    style: "text",
    detail: "activity",
    maxLength: 24,
    showActivity: true,
  },
  notifications: {
    startup: true,
    recall: false,
    retain: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isRecord(value) && isRecord(out[key]) ? merge(out[key], value) : value;
  }
  return out as T;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function envBool(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalString(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function validEnvVarName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function normalizeApiKeyRefString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("env:")) return undefined;
  const name = value.slice("env:".length);
  return validEnvVarName(name) ? value : undefined;
}

function normalizeApiKeyRef(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.source !== "env" || typeof value.name !== "string" || !validEnvVarName(value.name))
    return undefined;
  return `env:${value.name}`;
}

function resolveApiKeyRef(ref: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (!ref) return undefined;
  if (!ref.startsWith("env:")) return undefined;
  const name = ref.slice("env:".length);
  return name ? optionalString(env[name]) : undefined;
}

function directApiKey(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function stringMatrix(value: unknown, fallback: string[][]): string[][] {
  return Array.isArray(value) &&
    value.every(
      (scope) =>
        Array.isArray(scope) && scope.length > 0 && scope.every((item) => typeof item === "string"),
    )
    ? value
    : fallback;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  return Array.isArray(value) && value.every((item) => allowed.includes(item as T))
    ? (value as T[])
    : fallback;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function toolNameFilter(
  value: unknown,
  fallback: { include?: string[]; exclude?: string[] },
): { include?: string[]; exclude?: string[] } {
  if (!isRecord(value)) return fallback;
  const hasInclude = "include" in value;
  const hasExclude = "exclude" in value;
  const include = optionalStringArray(value.include);
  const exclude = optionalStringArray(value.exclude);
  if ((hasInclude && !include) || (hasExclude && !exclude) || (!hasInclude && !hasExclude)) {
    return fallback;
  }
  return {
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
  };
}

function hasConfiguredRecallField(rawConfig: unknown, field: string): boolean {
  return isRecord(rawConfig) && isRecord(rawConfig.recall) && field in rawConfig.recall;
}

export function normalizeConfig(
  config: ResolvedConfig,
  rawConfig?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const apiKeyRef =
    normalizeApiKeyRef(config.hindsight?.apiKey) ??
    normalizeApiKeyRefString(config.hindsight?.apiKeyRef) ??
    normalizeApiKeyRefString(DEFAULT_CONFIG.hindsight.apiKeyRef);
  const apiKey =
    directApiKey(config.hindsight?.apiKey, DEFAULT_CONFIG.hindsight.apiKey) ??
    resolveApiKeyRef(apiKeyRef, env);
  const projectBankId = optionalString(
    config.banks?.project?.bankId,
    DEFAULT_CONFIG.banks.project.bankId,
  );
  const globalBankId = optionalString(
    config.banks?.global?.bankId,
    DEFAULT_CONFIG.banks.global.bankId,
  );
  return {
    enabled: bool(config.enabled, DEFAULT_CONFIG.enabled),
    hindsight: {
      baseUrl: stringValue(config.hindsight?.baseUrl, DEFAULT_CONFIG.hindsight.baseUrl),
      ...(apiKey ? { apiKey } : {}),
      ...(apiKeyRef ? { apiKeyRef } : {}),
      timeoutMs: positiveInt(config.hindsight?.timeoutMs, DEFAULT_CONFIG.hindsight.timeoutMs),
    },
    banks: {
      project: {
        enabled: bool(config.banks?.project?.enabled, DEFAULT_CONFIG.banks.project.enabled),
        ...(projectBankId ? { bankId: projectBankId } : {}),
        derive: enumValue(
          config.banks?.project?.derive,
          ["repo", "cwd", "manual"],
          DEFAULT_CONFIG.banks.project.derive,
        ),
        ...(typeof config.banks?.project?.mission === "string"
          ? { mission: config.banks.project.mission }
          : {}),
      },
      global: {
        enabled: bool(config.banks?.global?.enabled, DEFAULT_CONFIG.banks.global.enabled),
        ...(globalBankId ? { bankId: globalBankId } : {}),
        ...(typeof config.banks?.global?.mission === "string"
          ? { mission: config.banks.global.mission }
          : {}),
      },
    },
    observations: {
      enabled: bool(config.observations?.enabled, DEFAULT_CONFIG.observations.enabled),
      scopes: stringMatrix(config.observations?.scopes, DEFAULT_CONFIG.observations.scopes),
    },
    recall: {
      enabled: bool(config.recall?.enabled, DEFAULT_CONFIG.recall.enabled),
      budget: enumValue(
        config.recall?.budget,
        ["low", "mid", "high"],
        DEFAULT_CONFIG.recall.budget,
      ),
      maxTokens: positiveInt(config.recall?.maxTokens, DEFAULT_CONFIG.recall.maxTokens),
      types: stringArray(config.recall?.types, DEFAULT_CONFIG.recall.types),
      contextTurns: positiveInt(config.recall?.contextTurns, DEFAULT_CONFIG.recall.contextTurns),
      roles: enumArray(
        config.recall?.roles,
        ["user", "assistant", "tool", "system"],
        DEFAULT_CONFIG.recall.roles,
      ),
      maxQueryChars: positiveInt(config.recall?.maxQueryChars, DEFAULT_CONFIG.recall.maxQueryChars),
      queryPreamble:
        typeof config.recall?.queryPreamble === "string"
          ? config.recall.queryPreamble
          : DEFAULT_CONFIG.recall.queryPreamble,
      projectQueryPreamble:
        hasConfiguredRecallField(rawConfig, "projectQueryPreamble") &&
        typeof config.recall?.projectQueryPreamble === "string"
          ? config.recall.projectQueryPreamble
          : hasConfiguredRecallField(rawConfig, "queryPreamble") &&
              typeof config.recall?.queryPreamble === "string"
            ? config.recall.queryPreamble
            : DEFAULT_CONFIG.recall.projectQueryPreamble,
      globalQueryPreamble:
        hasConfiguredRecallField(rawConfig, "globalQueryPreamble") &&
        typeof config.recall?.globalQueryPreamble === "string"
          ? config.recall.globalQueryPreamble
          : hasConfiguredRecallField(rawConfig, "queryPreamble") &&
              typeof config.recall?.queryPreamble === "string"
            ? config.recall.queryPreamble
            : DEFAULT_CONFIG.recall.globalQueryPreamble,
      includeDateInQuery: bool(
        config.recall?.includeDateInQuery,
        DEFAULT_CONFIG.recall.includeDateInQuery,
      ),
      includeRepoHintsInQuery: bool(
        config.recall?.includeRepoHintsInQuery,
        DEFAULT_CONFIG.recall.includeRepoHintsInQuery,
      ),
      storeLastRecall: bool(config.recall?.storeLastRecall, DEFAULT_CONFIG.recall.storeLastRecall),
      lastRecallPath:
        typeof config.recall?.lastRecallPath === "string" && config.recall.lastRecallPath.trim()
          ? config.recall.lastRecallPath
          : DEFAULT_CONFIG.recall.lastRecallPath,
      topK: positiveInt(config.recall?.topK, DEFAULT_CONFIG.recall.topK),
      timeoutMs: positiveInt(config.recall?.timeoutMs, DEFAULT_CONFIG.recall.timeoutMs),
      injectionMode: "context",
      injectionPosition: enumValue(
        config.recall?.injectionPosition,
        ["prepend", "append"],
        DEFAULT_CONFIG.recall.injectionPosition,
      ),
      includeFactsInDebug: bool(
        config.recall?.includeFactsInDebug,
        DEFAULT_CONFIG.recall.includeFactsInDebug,
      ),
    },
    retain: {
      enabled: bool(config.retain?.enabled, DEFAULT_CONFIG.retain.enabled),
      async: bool(config.retain?.async, DEFAULT_CONFIG.retain.async),
      updateMode: enumValue(
        config.retain?.updateMode,
        ["append", "replace"],
        DEFAULT_CONFIG.retain.updateMode,
      ),
      appendFallback: enumValue(
        config.retain?.appendFallback,
        ["error", "per-turn-documents"],
        DEFAULT_CONFIG.retain.appendFallback,
      ),
      content: {
        user: enumArray(config.retain?.content?.user, ["text"], DEFAULT_CONFIG.retain.content.user),
        assistant: enumArray(
          config.retain?.content?.assistant,
          ["text", "toolCall", "thinking"],
          DEFAULT_CONFIG.retain.content.assistant,
        ),
        toolResult: enumArray(
          config.retain?.content?.toolResult,
          ["error", "summary", "content"],
          DEFAULT_CONFIG.retain.content.toolResult,
        ),
      },
      toolFilter: {
        toolCall: toolNameFilter(
          config.retain?.toolFilter?.toolCall,
          DEFAULT_CONFIG.retain.toolFilter.toolCall,
        ),
        toolResult: toolNameFilter(
          config.retain?.toolFilter?.toolResult,
          DEFAULT_CONFIG.retain.toolFilter.toolResult,
        ),
      },
      strip: {
        message: stringArray(config.retain?.strip?.message, DEFAULT_CONFIG.retain.strip.message),
        topLevel: stringArray(config.retain?.strip?.topLevel, DEFAULT_CONFIG.retain.strip.topLevel),
      },
      redactSecrets: bool(config.retain?.redactSecrets, DEFAULT_CONFIG.retain.redactSecrets),
      queuePath: stringValue(config.retain?.queuePath, DEFAULT_CONFIG.retain.queuePath),
      shutdownFlushMaxJobs: positiveInt(
        config.retain?.shutdownFlushMaxJobs,
        DEFAULT_CONFIG.retain.shutdownFlushMaxJobs,
      ),
      shutdownFlushTimeoutMs: positiveInt(
        config.retain?.shutdownFlushTimeoutMs,
        DEFAULT_CONFIG.retain.shutdownFlushTimeoutMs,
      ),
    },
    import: {
      includeBranches: enumValue(
        config.import?.includeBranches,
        ["current-only", "all-leaves"],
        DEFAULT_CONFIG.import.includeBranches,
      ),
      replaceExistingImportedDocs: bool(
        config.import?.replaceExistingImportedDocs,
        DEFAULT_CONFIG.import.replaceExistingImportedDocs,
      ),
      manifestPath: stringValue(config.import?.manifestPath, DEFAULT_CONFIG.import.manifestPath),
      checkpointPath: stringValue(
        config.import?.checkpointPath,
        DEFAULT_CONFIG.import.checkpointPath,
      ),
      resume: bool(config.import?.resume, DEFAULT_CONFIG.import.resume),
    },
    status: {
      style: enumValue(
        config.status?.style,
        ["off", "text", "emoji", "nerdfont"],
        DEFAULT_CONFIG.status.style,
      ),
      detail: enumValue(
        config.status?.detail,
        ["minimal", "project", "activity", "verbose"],
        DEFAULT_CONFIG.status.detail,
      ),
      maxLength: positiveInt(config.status?.maxLength, DEFAULT_CONFIG.status.maxLength),
      showActivity: bool(config.status?.showActivity, DEFAULT_CONFIG.status.showActivity),
    },
    notifications: {
      startup: bool(config.notifications?.startup, DEFAULT_CONFIG.notifications.startup),
      recall: bool(config.notifications?.recall, DEFAULT_CONFIG.notifications.recall),
      retain: bool(config.notifications?.retain, DEFAULT_CONFIG.notifications.retain),
    },
  };
}

export function resolveConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  let rawConfig: Record<string, unknown> = {};
  let config = DEFAULT_CONFIG;
  const home = env.HOME;
  const homeConfig = home ? readJson(join(home, ".pi", "agent", "hindsight.json")) : undefined;
  rawConfig = merge(rawConfig, homeConfig);
  config = merge(config, homeConfig);
  const projectConfig = readJson(join(cwd, ".pi", "hindsight.json"));
  rawConfig = merge(rawConfig, projectConfig);
  config = merge(config, projectConfig);

  const enabled = envBool(env, "PI_HINDSIGHT_ENABLED");
  if (enabled !== undefined) {
    rawConfig = merge(rawConfig, { enabled });
    config = merge(config, { enabled });
  }
  if (env.HINDSIGHT_BASE_URL) {
    rawConfig = merge(rawConfig, { hindsight: { baseUrl: env.HINDSIGHT_BASE_URL } });
    config = merge(config, { hindsight: { baseUrl: env.HINDSIGHT_BASE_URL } });
  }
  if (env.HINDSIGHT_API_KEY_REF && validEnvVarName(env.HINDSIGHT_API_KEY_REF)) {
    const ref = { source: "env", name: env.HINDSIGHT_API_KEY_REF };
    rawConfig = merge(rawConfig, { hindsight: { apiKey: ref } });
    config = merge(config, { hindsight: { apiKey: ref } });
  }
  if (env.HINDSIGHT_API_KEY) {
    rawConfig = merge(rawConfig, { hindsight: { apiKey: env.HINDSIGHT_API_KEY } });
    config = merge(config, { hindsight: { apiKey: env.HINDSIGHT_API_KEY } });
  }
  if (env.PI_HINDSIGHT_PROJECT_BANK_ID) {
    const patch = {
      banks: { project: { bankId: env.PI_HINDSIGHT_PROJECT_BANK_ID, derive: "manual" } },
    };
    rawConfig = merge(rawConfig, patch);
    config = merge(config, patch);
  }
  if (env.PI_HINDSIGHT_GLOBAL_BANK_ID) {
    const patch = {
      banks: { global: { enabled: true, bankId: env.PI_HINDSIGHT_GLOBAL_BANK_ID } },
    };
    rawConfig = merge(rawConfig, patch);
    config = merge(config, patch);
  }
  return normalizeConfig(config, rawConfig, env);
}

export { DEFAULT_CONFIG };
