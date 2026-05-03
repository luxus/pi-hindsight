import type { HindsightEntityInput, ResolvedConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import {
  bool,
  enumArray,
  enumValue,
  isRecord,
  optionalString,
  optionalStringArray,
  positiveInt,
  stringArray,
  stringMatrix,
  stringValue,
  validEnvVarName,
} from "./config-utils.js";

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

function entityArray(value: unknown, fallback: HindsightEntityInput[]): HindsightEntityInput[] {
  if (!Array.isArray(value)) return fallback;
  const entities = value
    .map((item) => {
      if (!isRecord(item) || typeof item.text !== "string" || item.text.length === 0)
        return undefined;
      return {
        text: item.text,
        ...(typeof item.type === "string" && item.type.length > 0 ? { type: item.type } : {}),
      } satisfies HindsightEntityInput;
    })
    .filter((item): item is HindsightEntityInput => Boolean(item));
  return entities.length === value.length ? entities : fallback;
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

function missionFields(bankConfig: unknown) {
  if (!isRecord(bankConfig)) return {};
  return {
    ...(typeof bankConfig.retainMission === "string"
      ? { retainMission: bankConfig.retainMission }
      : {}),
    ...(typeof bankConfig.reflectMission === "string"
      ? { reflectMission: bankConfig.reflectMission }
      : {}),
    ...(typeof bankConfig.observationsMission === "string"
      ? { observationsMission: bankConfig.observationsMission }
      : {}),
  };
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
        ...missionFields(config.banks?.project),
      },
      global: {
        enabled: bool(config.banks?.global?.enabled, DEFAULT_CONFIG.banks.global.enabled),
        ...(globalBankId ? { bankId: globalBankId } : {}),
        ...missionFields(config.banks?.global),
      },
    },
    observations: {
      enabled: bool(config.observations?.enabled, DEFAULT_CONFIG.observations.enabled),
      scopes: stringMatrix(config.observations?.scopes, DEFAULT_CONFIG.observations.scopes),
    },
    globalRetain: {
      mode: enumValue(
        config.globalRetain?.mode,
        ["explicit-only", "router"],
        DEFAULT_CONFIG.globalRetain.mode,
      ),
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
      ...(optionalString(config.recall?.queryTimestamp, DEFAULT_CONFIG.recall.queryTimestamp)
        ? {
            queryTimestamp: stringValue(
              config.recall?.queryTimestamp,
              DEFAULT_CONFIG.recall.queryTimestamp ?? "",
            ),
          }
        : {}),
    },
    retain: {
      enabled: bool(config.retain?.enabled, DEFAULT_CONFIG.retain.enabled),
      async: bool(config.retain?.async, DEFAULT_CONFIG.retain.async),
      updateMode: enumValue(
        config.retain?.updateMode,
        ["append", "replace"],
        DEFAULT_CONFIG.retain.updateMode,
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
      entities: entityArray(config.retain?.entities, DEFAULT_CONFIG.retain.entities),
      queuePath: stringValue(config.retain?.queuePath, DEFAULT_CONFIG.retain.queuePath),
      flushIntervalMs: Math.max(
        0,
        typeof config.retain?.flushIntervalMs === "number" &&
          Number.isInteger(config.retain.flushIntervalMs)
          ? config.retain.flushIntervalMs
          : DEFAULT_CONFIG.retain.flushIntervalMs,
      ),
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
