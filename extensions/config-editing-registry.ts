import { DEFAULT_CONFIG } from "./config.js";
import type { ResolvedConfig } from "./types.js";
import type { ConfigScope, ConfigSource, MemoryProfile } from "./config-writer.js";
import type { ConfigEditingField, FieldId } from "./config-editing-types.js";
import { defaultGlobalBankMissions, defaultProjectBankMissions } from "./bank-operations.js";
import { CONFIG_FIELD_PATHS, CONFIG_FIELD_RESET_KEYS } from "./config-field-paths.js";
export { CONFIG_FIELD_PATHS, CONFIG_FIELD_RESET_KEYS } from "./config-field-paths.js";

function memoryProfileLabel(config: ResolvedConfig): MemoryProfile {
  if (!config.banks.project.enabled) return "global-only";
  if (config.banks.global.enabled) return "project+global";
  return "project-only";
}

export function enabledDisabled(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function changed(value: string, defaultValue: string): boolean {
  return value !== defaultValue;
}

export function apiKeyEnvName(config: ResolvedConfig): string {
  return config.hindsight.apiKeyRef?.startsWith("env:")
    ? config.hindsight.apiKeyRef.slice(4)
    : "not set";
}

function apiKeySourceLabel(config: ResolvedConfig): string {
  const envName = apiKeyEnvName(config);
  if (envName !== "not set")
    return config.hindsight.apiKey ? `${envName} (resolved)` : `${envName} (missing)`;
  return config.hindsight.apiKey ? "set directly or HINDSIGHT_API_KEY env" : "not set";
}

type BaseConfigEditingField = Omit<
  ConfigEditingField,
  "projectValue" | "globalValue" | "envValue" | "source" | "editableScopes"
>;

type FieldTab = BaseConfigEditingField["tab"];
type FieldKind = BaseConfigEditingField["kind"];

type FieldArgs = {
  id: FieldId;
  tab: FieldTab;
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  changed?: boolean;
  resetKey?: BaseConfigEditingField["resetKey"];
  kind: FieldKind;
  choices?: string[];
  advanced?: boolean;
};

function field(args: FieldArgs): BaseConfigEditingField {
  return {
    ...args,
    resetKey: args.resetKey ?? CONFIG_FIELD_RESET_KEYS[args.id],
    changed: args.changed ?? changed(args.value, args.defaultValue),
  };
}

function booleanField(
  args: Omit<FieldArgs, "value" | "defaultValue" | "kind"> & {
    value: boolean;
    defaultValue: boolean;
  },
): BaseConfigEditingField {
  return field({
    ...args,
    value: enabledDisabled(args.value),
    defaultValue: enabledDisabled(args.defaultValue),
    changed: args.value !== args.defaultValue,
    kind: "boolean",
  });
}

function textField(args: Omit<FieldArgs, "kind">): BaseConfigEditingField {
  return field({ ...args, kind: "text" });
}

function positiveIntField(
  args: Omit<FieldArgs, "value" | "defaultValue" | "kind"> & {
    value: number;
    defaultValue: number;
    suffix?: string;
  },
): BaseConfigEditingField {
  const { suffix = "", ...fieldArgs } = args;
  return field({
    ...fieldArgs,
    value: `${args.value}${suffix}`,
    defaultValue: `${args.defaultValue}${suffix}`,
    changed: args.value !== args.defaultValue,
    kind: "positive-int",
  });
}

function selectField(
  args: Omit<FieldArgs, "kind"> & { choices: string[] },
): BaseConfigEditingField {
  return field({ ...args, kind: "select" });
}

function valueAt(config: Record<string, unknown>, path: string[]): unknown {
  let value: unknown = config;
  for (const part of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function displayLayerValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return enabledDisabled(value);
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { source?: unknown }).source === "env" &&
    typeof (value as { name?: unknown }).name === "string"
  ) {
    return String((value as { name: string }).name);
  }
  return JSON.stringify(value);
}

function sourceFor(
  layers: { project: Record<string, unknown>; global: Record<string, unknown> },
  path: string[],
  envValue?: string,
): ConfigSource {
  if (envValue !== undefined) return "env";
  if (valueAt(layers.project, path) !== undefined) return "project";
  if (valueAt(layers.global, path) !== undefined) return "global";
  return "default";
}

export function buildBaseConfigEditingFields(
  config: ResolvedConfig,
  projectBankId: string,
): BaseConfigEditingField[] {
  const defaults = DEFAULT_CONFIG;
  const profile = memoryProfileLabel(config);
  const defaultProfile = memoryProfileLabel(defaults);
  const projectMissionDefaults = defaultProjectBankMissions();
  const globalMissionDefaults = defaultGlobalBankMissions();
  const globalBankId = config.banks.global.bankId ?? "not set";
  const defaultGlobalBankId = defaults.banks.global.bankId ?? "not set";
  return [
    booleanField({
      id: "enabled",
      tab: "Connection",
      label: "Extension active",
      description: "Master switch. When off, automatic recall and retain are skipped.",
      value: config.enabled,
      defaultValue: defaults.enabled,
      resetKey: "enabled",
    }),
    textField({
      id: "baseUrl",
      tab: "Connection",
      label: "Hindsight API URL",
      description: "Server endpoint used for recall, retain, reflect, and bank setup.",
      value: config.hindsight.baseUrl,
      defaultValue: defaults.hindsight.baseUrl,
      resetKey: "hindsight.baseUrl",
    }),
    textField({
      id: "apiKeyEnv",
      tab: "Connection",
      label: "API key source",
      description:
        "Recommended: environment variable name that contains the API key. Editing writes a safe env SecretRef, not the raw secret.",
      value: apiKeySourceLabel(config),
      defaultValue: "not set",
      resetKey: "hindsight.apiKey",
    }),
    textField({
      id: "apiKeyDirect",
      tab: "Connection",
      label: "Direct API key (not recommended)",
      description:
        "Advanced. Writes raw API key into config. Prefer API key source/env var whenever possible.",
      value: config.hindsight.apiKey && apiKeyEnvName(config) === "not set" ? "set" : "not set",
      defaultValue: "not set",
      resetKey: "hindsight.apiKey",
      advanced: true,
    }),
    positiveIntField({
      id: "timeoutMs",
      tab: "Connection",
      label: "Request timeout",
      description: "Maximum time to wait for Hindsight network calls.",
      value: config.hindsight.timeoutMs,
      defaultValue: defaults.hindsight.timeoutMs,
      suffix: " ms",
      resetKey: "hindsight.timeoutMs",
    }),
    selectField({
      id: "memoryProfile",
      tab: "Banks",
      label: "Memory scope",
      description:
        "Project-only is safest. Project+global also recalls personal cross-project memory.",
      value: profile,
      defaultValue: defaultProfile,
      resetKey: "banks.profile",
      choices: ["project-only", "project+global", "global-only"],
    }),
    textField({
      id: "projectBankId",
      tab: "Banks",
      label: "Project bank ID",
      description: "Bank used for this repository. Default derives a stable ID from repo identity.",
      value: projectBankId,
      defaultValue: "auto-derived",
      changed: Boolean(config.banks.project.bankId),
      resetKey: "banks.project.bankId",
    }),
    textField({
      id: "projectRetainMission",
      tab: "Banks",
      label: "Project retain mission",
      description: `Advanced. Overrides what project retain extracts. Built-in default: ${projectMissionDefaults.retainMission}`,
      value: config.banks.project.retainMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.project.retainMission),
      resetKey: "banks.project.retainMission",
      advanced: true,
    }),
    textField({
      id: "projectReflectMission",
      tab: "Banks",
      label: "Project reflect mission",
      description: `Advanced. Overrides how project reflect uses memories. Built-in default: ${projectMissionDefaults.reflectMission}`,
      value: config.banks.project.reflectMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.project.reflectMission),
      resetKey: "banks.project.reflectMission",
      advanced: true,
    }),
    textField({
      id: "projectObservationsMission",
      tab: "Banks",
      label: "Project observations mission",
      description: `Advanced. Overrides what project observation consolidation synthesizes. Built-in default: ${projectMissionDefaults.observationsMission}`,
      value: config.banks.project.observationsMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.project.observationsMission),
      resetKey: "banks.project.observationsMission",
      advanced: true,
    }),
    booleanField({
      id: "globalBankEnabled",
      tab: "Banks",
      label: "Global memory enabled",
      description: "Allows cross-project recall from a shared bank.",
      value: config.banks.global.enabled,
      defaultValue: defaults.banks.global.enabled,
      resetKey: "banks.global.enabled",
    }),
    textField({
      id: "globalBankId",
      tab: "Banks",
      label: "Global bank ID",
      description: "Shared bank used only when global memory is enabled.",
      value: globalBankId,
      defaultValue: defaultGlobalBankId,
      resetKey: "banks.global.bankId",
    }),
    textField({
      id: "globalRetainMission",
      tab: "Banks",
      label: "Global retain mission",
      description: `Advanced. Overrides what global retain extracts. Built-in default: ${globalMissionDefaults.retainMission}`,
      value: config.banks.global.retainMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.global.retainMission),
      resetKey: "banks.global.retainMission",
      advanced: true,
    }),
    textField({
      id: "globalReflectMission",
      tab: "Banks",
      label: "Global reflect mission",
      description: `Advanced. Overrides how global reflect uses memories. Built-in default: ${globalMissionDefaults.reflectMission}`,
      value: config.banks.global.reflectMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.global.reflectMission),
      resetKey: "banks.global.reflectMission",
      advanced: true,
    }),
    textField({
      id: "globalObservationsMission",
      tab: "Banks",
      label: "Global observations mission",
      description: `Advanced. Overrides what global observation consolidation synthesizes. Built-in default: ${globalMissionDefaults.observationsMission}`,
      value: config.banks.global.observationsMission ?? "built-in default",
      defaultValue: "built-in default",
      changed: Boolean(config.banks.global.observationsMission),
      resetKey: "banks.global.observationsMission",
      advanced: true,
    }),
    booleanField({
      id: "recallEnabled",
      tab: "Recall",
      label: "Automatic recall",
      description: "Looks up memory before answer generation and injects it ephemerally.",
      value: config.recall.enabled,
      defaultValue: defaults.recall.enabled,
      resetKey: "recall.enabled",
    }),
    selectField({
      id: "recallBudget",
      tab: "Recall",
      label: "Recall depth",
      description: "Low, mid, or high retrieval effort.",
      value: config.recall.budget,
      defaultValue: defaults.recall.budget,
      resetKey: "recall.budget",
      choices: ["low", "mid", "high"],
    }),
    positiveIntField({
      id: "recallMaxTokens",
      tab: "Recall",
      label: "Recall token limit",
      description: "Maximum memory tokens injected into context.",
      value: config.recall.maxTokens,
      defaultValue: defaults.recall.maxTokens,
      resetKey: "recall.maxTokens",
    }),
    booleanField({
      id: "recallStoreLast",
      tab: "Recall",
      label: "Store last recall snapshot",
      description:
        "Advanced. Writes the latest successful recall snapshot to a local sidecar for /hindsight:last-recall.",
      value: config.recall.storeLastRecall,
      defaultValue: defaults.recall.storeLastRecall,
      resetKey: "recall.storeLastRecall",
      advanced: true,
    }),
    booleanField({
      id: "recallStoreFailures",
      tab: "Recall",
      label: "Store recall failures",
      description:
        "Advanced. Also records redacted failed recall attempts in the last-recall sidecar. Requires storing last recall snapshots.",
      value: config.recall.storeLastRecallFailures,
      defaultValue: defaults.recall.storeLastRecallFailures,
      resetKey: "recall.storeLastRecallFailures",
      advanced: true,
    }),
    booleanField({
      id: "retainEnabled",
      tab: "Retain",
      label: "Automatic retain",
      description: "Stores raw structured conversation deltas after turns.",
      value: config.retain.enabled,
      defaultValue: defaults.retain.enabled,
      resetKey: "retain.enabled",
    }),
    booleanField({
      id: "retainAsync",
      tab: "Retain",
      label: "Queued retain writes",
      description: "Writes retain jobs through durable queue instead of blocking UI.",
      value: config.retain.async,
      defaultValue: defaults.retain.async,
      resetKey: "retain.async",
      advanced: true,
    }),
    textField({
      id: "queuePath",
      tab: "Retain",
      label: "Retain queue file",
      description: "JSONL retry queue used when Hindsight is unavailable.",
      value: config.retain.queuePath,
      defaultValue: defaults.retain.queuePath,
      resetKey: "retain.queuePath",
      advanced: true,
    }),
    selectField({
      id: "globalRetainMode",
      tab: "Retain",
      label: "Global retain mode",
      description:
        "Advanced. explicit-only keeps global writes manual; router enables future high-confidence routing.",
      value: config.globalRetain.mode,
      defaultValue: defaults.globalRetain.mode,
      resetKey: "globalRetain.mode",
      choices: ["explicit-only", "router"],
      advanced: true,
    }),
    selectField({
      id: "importBranches",
      tab: "Import",
      label: "Historical import scope",
      description: "Import current branch only, or every leaf branch explicitly.",
      value: config.import.includeBranches,
      defaultValue: defaults.import.includeBranches,
      resetKey: "import.includeBranches",
      choices: ["current-only", "all-leaves"],
    }),
    textField({
      id: "importManifest",
      tab: "Import",
      label: "Import manifest file",
      description: "Tracks imported sessions so reimports stay deterministic.",
      value: config.import.manifestPath,
      defaultValue: defaults.import.manifestPath,
      resetKey: "import.manifestPath",
      advanced: true,
    }),
    textField({
      id: "importCheckpoint",
      tab: "Import",
      label: "Import checkpoint file",
      description: "Tracks import progress so interrupted imports can resume safely.",
      value: config.import.checkpointPath,
      defaultValue: defaults.import.checkpointPath,
      resetKey: "import.checkpointPath",
      advanced: true,
    }),
    booleanField({
      id: "importReplaceExisting",
      tab: "Import",
      label: "Replace existing import docs",
      description:
        "Uses deterministic replace mode for historical reimports instead of appending duplicates.",
      value: config.import.replaceExistingImportedDocs,
      defaultValue: defaults.import.replaceExistingImportedDocs,
      resetKey: "import.replaceExistingImportedDocs",
      advanced: true,
    }),
    booleanField({
      id: "importResume",
      tab: "Import",
      label: "Resume interrupted imports",
      description: "Skips completed import documents when checkpoint content hashes match.",
      value: config.import.resume,
      defaultValue: defaults.import.resume,
      resetKey: "import.resume",
      advanced: true,
    }),
    selectField({
      id: "statusStyle",
      tab: "UI",
      label: "Footer status style",
      description: "Off, plain text, emoji, or nerdfont symbols.",
      value: config.status.style,
      defaultValue: defaults.status.style,
      resetKey: "status.style",
      choices: ["off", "text", "emoji", "nerdfont"],
    }),
    selectField({
      id: "statusDetail",
      tab: "UI",
      label: "Footer status detail",
      description: "How much Hindsight info appears in Pi footer.",
      value: config.status.detail,
      defaultValue: defaults.status.detail,
      resetKey: "status.detail",
      choices: ["minimal", "project", "activity", "verbose"],
    }),
    positiveIntField({
      id: "statusMaxLength",
      tab: "UI",
      label: "Footer max length",
      description: "Maximum characters used by Hindsight footer status.",
      value: config.status.maxLength,
      defaultValue: defaults.status.maxLength,
      resetKey: "status.maxLength",
    }),
    booleanField({
      id: "statusActivity",
      tab: "UI",
      label: "Show live activity",
      description: "Displays recall/retain activity in the status line.",
      value: config.status.showActivity,
      defaultValue: defaults.status.showActivity,
      resetKey: "status.showActivity",
    }),
    booleanField({
      id: "notifyStartup",
      tab: "UI",
      label: "Startup notification",
      description: "Shows selected Hindsight bank when Pi session starts.",
      value: config.notifications.startup,
      defaultValue: defaults.notifications.startup,
      resetKey: "notifications.startup",
    }),
    booleanField({
      id: "notifyRecall",
      tab: "UI",
      label: "Recall notifications",
      description: "Shows a toast when automatic recall runs.",
      value: config.notifications.recall,
      defaultValue: defaults.notifications.recall,
      resetKey: "notifications.recall",
    }),
    booleanField({
      id: "notifyRetain",
      tab: "UI",
      label: "Retain notifications",
      description: "Shows a toast when automatic retain queues memory.",
      value: config.notifications.retain,
      defaultValue: defaults.notifications.retain,
      resetKey: "notifications.retain",
    }),
  ];
}
export const PROJECT_ONLY_FIELD_IDS = new Set<FieldId>([
  "projectBankId",
  "projectRetainMission",
  "projectReflectMission",
  "projectObservationsMission",
  "memoryProfile",
  "queuePath",
  "importBranches",
  "importManifest",
  "importCheckpoint",
  "importReplaceExisting",
  "importResume",
]);

export function editableScopesForField(fieldId: FieldId): ConfigScope[] {
  return PROJECT_ONLY_FIELD_IDS.has(fieldId) ? ["project"] : ["project", "global"];
}

export function configEnvValues(env: NodeJS.ProcessEnv): Partial<Record<FieldId, string>> {
  return {
    ...(env.PI_HINDSIGHT_ENABLED ? { enabled: env.PI_HINDSIGHT_ENABLED } : {}),
    ...(env.HINDSIGHT_BASE_URL ? { baseUrl: env.HINDSIGHT_BASE_URL } : {}),
    ...(env.HINDSIGHT_API_KEY || env.HINDSIGHT_API_KEY_REF
      ? { apiKeyEnv: env.HINDSIGHT_API_KEY_REF ?? "HINDSIGHT_API_KEY" }
      : {}),
    ...(env.PI_HINDSIGHT_PROJECT_BANK_ID
      ? { projectBankId: env.PI_HINDSIGHT_PROJECT_BANK_ID }
      : {}),
    ...(env.PI_HINDSIGHT_GLOBAL_BANK_ID
      ? { globalBankId: env.PI_HINDSIGHT_GLOBAL_BANK_ID, globalBankEnabled: "enabled" }
      : {}),
  };
}

function layerField(
  base: BaseConfigEditingField,
  layers: { project: Record<string, unknown>; global: Record<string, unknown> },
  envValue: string | undefined,
): ConfigEditingField {
  const path = CONFIG_FIELD_PATHS[base.id];
  const projectValue = displayLayerValue(valueAt(layers.project, path));
  const globalValue = displayLayerValue(valueAt(layers.global, path));
  const source = sourceFor(layers, path, envValue);
  return {
    ...base,
    ...(projectValue !== undefined ? { projectValue } : {}),
    ...(globalValue !== undefined ? { globalValue } : {}),
    ...(envValue !== undefined ? { envValue } : {}),
    source,
    editableScopes: editableScopesForField(base.id),
    changed: source !== "default",
  };
}

export function buildConfigEditingFieldsFromRegistry(
  config: ResolvedConfig,
  projectBankId: string,
  layers: {
    project: Record<string, unknown>;
    global: Record<string, unknown>;
    env: NodeJS.ProcessEnv;
  },
): ConfigEditingField[] {
  const envValues = configEnvValues(layers.env);
  return buildBaseConfigEditingFields(config, projectBankId).map((base) =>
    layerField(base, layers, envValues[base.id]),
  );
}

function missionSummary(mission: string | undefined): string {
  if (!mission) return "built-in default";
  return mission.length > 80 ? `${mission.slice(0, 77)}...` : mission;
}

export function buildStatusFacts(
  config: ResolvedConfig,
  projectBankId: string,
  extraFacts: Array<[string, string]> = [],
): Array<[string, string]> {
  const profile = memoryProfileLabel(config);
  return [
    ...extraFacts,
    ["Extension", enabledDisabled(config.enabled)],
    ["Memory scope", profile],
    ["Active project bank", config.banks.project.enabled ? projectBankId : "disabled"],
    [
      "Global bank",
      config.banks.global.enabled ? (config.banks.global.bankId ?? "missing id") : "disabled",
    ],
    ["Project retain mission", missionSummary(config.banks.project.retainMission)],
    ["Project reflect mission", missionSummary(config.banks.project.reflectMission)],
    ["Project observations mission", missionSummary(config.banks.project.observationsMission)],
    ["Global retain mission", missionSummary(config.banks.global.retainMission)],
    ["Global reflect mission", missionSummary(config.banks.global.reflectMission)],
    ["Global observations mission", missionSummary(config.banks.global.observationsMission)],
    ["Global retain mode", config.globalRetain.mode],
    ["Recall", enabledDisabled(config.recall.enabled)],
    ["Retain", enabledDisabled(config.retain.enabled)],
    ["Retain queue", config.retain.queuePath],
    ["Hindsight API", config.hindsight.baseUrl],
  ];
}
