import { DEFAULT_CONFIG } from "./config.js";
import type { ResolvedConfig } from "./types.js";
import {
  DEFAULT_GLOBAL_BANK_ID,
  type ConfigScope,
  type ConfigSource,
  type MemoryProfile,
  type ProjectConfigPatchInput,
} from "./config-writer.js";
import type { ConfigEditingField, FieldId } from "./config-editing-types.js";
import { CONFIG_FIELD_PATHS, CONFIG_FIELD_RESET_KEYS } from "./config-field-paths.js";
export { CONFIG_FIELD_PATHS, CONFIG_FIELD_RESET_KEYS } from "./config-field-paths.js";

function memoryProfileLabel(config: ResolvedConfig): MemoryProfile {
  if (!config.banks.project.enabled) return "global-only";
  if (config.banks.user.enabled) return "project+global";
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
  const globalBankId = config.banks.user.bankId ?? "not set";
  const defaultGlobalBankId = defaults.banks.user.bankId ?? "not set";
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
    booleanField({
      id: "globalBankEnabled",
      tab: "Banks",
      label: "User memory enabled",
      description: "Allows cross-project recall from a shared bank.",
      value: config.banks.user.enabled,
      defaultValue: defaults.banks.user.enabled,
      resetKey: "banks.global.enabled",
    }),
    textField({
      id: "globalBankId",
      tab: "Banks",
      label: "User bank ID",
      description: "Shared user bank used only when user memory is enabled.",
      value: globalBankId,
      defaultValue: defaultGlobalBankId,
      resetKey: "banks.global.bankId",
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
      label: "User retain mode",
      description:
        "Advanced. explicit-only keeps global writes manual; router enables future high-confidence routing.",
      value: config.userRetain.mode,
      defaultValue: defaults.userRetain.mode,
      resetKey: "globalRetain.mode",
      choices: ["explicit-only", "router"],
      advanced: true,
    }),
    selectField({
      id: "importMode",
      tab: "Import",
      label: "Import mode",
      description:
        "Curated drops noisy successful tool results from preview metrics; raw keeps current raw branch import behavior; forensic preserves recall blocks too.",
      value: config.import.mode,
      defaultValue: defaults.import.mode,
      resetKey: "import.mode",
      choices: ["curated", "raw", "forensic"],
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
    selectField({
      id: "importToolResults",
      tab: "Import",
      label: "Successful tool results",
      description:
        "Curated import defaults to errors-only; summary keeps bounded low-noise successful tool output; content keeps allowed full successful tool content.",
      value: config.import.toolResults,
      defaultValue: defaults.import.toolResults,
      resetKey: "import.toolResults",
      choices: ["errors-only", "summary", "content"],
    }),
    positiveIntField({
      id: "importToolSummaryMaxChars",
      tab: "Import",
      label: "Tool summary max chars",
      description: "Maximum characters kept for successful tool summaries in curated imports.",
      value: config.import.toolResultSummaryMaxChars,
      defaultValue: defaults.import.toolResultSummaryMaxChars,
      resetKey: "import.toolResultSummaryMaxChars",
      advanced: true,
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
  "memoryProfile",
  "queuePath",
  "importMode",
  "importBranches",
  "importToolResults",
  "importToolSummaryMaxChars",
  "importManifest",
  "importCheckpoint",
  "importReplaceExisting",
  "importResume",
]);

export function editableScopesForField(fieldId: FieldId): ConfigScope[] {
  return PROJECT_ONLY_FIELD_IDS.has(fieldId) ? ["project"] : ["project", "global"];
}

export function configEnvValues(env: NodeJS.ProcessEnv): Partial<Record<FieldId, string>> {
  const userBankId = env.PI_HINDSIGHT_USER_BANK_ID || env.PI_HINDSIGHT_GLOBAL_BANK_ID;
  return {
    ...(env.PI_HINDSIGHT_ENABLED ? { enabled: env.PI_HINDSIGHT_ENABLED } : {}),
    ...(env.HINDSIGHT_BASE_URL ? { baseUrl: env.HINDSIGHT_BASE_URL } : {}),
    ...(env.HINDSIGHT_API_KEY || env.HINDSIGHT_API_KEY_REF
      ? { apiKeyEnv: env.HINDSIGHT_API_KEY_REF ?? "HINDSIGHT_API_KEY" }
      : {}),
    ...(env.PI_HINDSIGHT_PROJECT_BANK_ID
      ? { projectBankId: env.PI_HINDSIGHT_PROJECT_BANK_ID }
      : {}),
    ...(userBankId ? { globalBankId: userBankId, globalBankEnabled: "enabled" } : {}),
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

export function parseConfigEditingFieldInput(
  field: Pick<ConfigEditingField, "id" | "kind">,
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (field.kind !== "positive-int") return value;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${field.id} must be a positive integer`);
  return value;
}

export function patchForConfigEditingField(
  fieldId: FieldId,
  value: string,
  config: ResolvedConfig,
): ProjectConfigPatchInput | undefined {
  switch (fieldId) {
    case "enabled":
      return { enabled: value === "Enable" };
    case "baseUrl":
      return { baseUrl: value.trim() };
    case "apiKeyEnv":
      return { apiKeyEnvVar: value.trim() };
    case "apiKeyDirect":
      return { directApiKey: value.trim() };
    case "timeoutMs":
      return { timeoutMs: Number(value) };
    case "memoryProfile":
      return {
        memoryProfile: value as MemoryProfile,
        globalBankId: config.banks.user.bankId ?? DEFAULT_GLOBAL_BANK_ID,
      };
    case "projectBankId":
      return { projectBankId: value.trim() };
    case "projectRetainMission":
      return { projectRetainMission: value.trim() };
    case "projectReflectMission":
      return { projectReflectMission: value.trim() };
    case "projectObservationsMission":
      return { projectObservationsMission: value.trim() };
    case "globalBankEnabled":
      return { enableGlobalBank: value === "Enable" };
    case "globalBankId":
      return { globalBankId: value.trim() };
    case "globalRetainMission":
      return { globalRetainMission: value.trim() };
    case "globalReflectMission":
      return { globalReflectMission: value.trim() };
    case "globalObservationsMission":
      return { globalObservationsMission: value.trim() };
    case "globalRetainMode":
      return { globalRetainMode: value as "explicit-only" | "router" };
    case "recallEnabled":
      return { recallEnabled: value === "Enable" };
    case "recallBudget":
      return { recallBudget: value as "low" | "mid" | "high" };
    case "recallMaxTokens":
      return { recallMaxTokens: Number(value) };
    case "recallStoreLast":
      return { recallStoreLast: value === "Enable" };
    case "recallStoreFailures":
      return { recallStoreFailures: value === "Enable" };
    case "retainEnabled":
      return { retainEnabled: value === "Enable" };
    case "retainAsync":
      return { retainAsync: value === "Enable" };
    case "queuePath":
      return { queuePath: value.trim() };
    case "importMode":
      return { importMode: value as "curated" | "raw" | "forensic" };
    case "importBranches":
      return { importIncludeBranches: value as "current-only" | "all-leaves" };
    case "importToolResults":
      return { importToolResults: value as "errors-only" | "summary" | "content" };
    case "importToolSummaryMaxChars":
      return { importToolResultSummaryMaxChars: Number(value) };
    case "importManifest":
      return { importManifestPath: value.trim() };
    case "importCheckpoint":
      return { importCheckpointPath: value.trim() };
    case "importReplaceExisting":
      return { importReplaceExistingDocs: value === "Enable" };
    case "importResume":
      return { importResume: value === "Enable" };
    case "statusStyle":
      return { statusStyle: value as "off" | "text" | "emoji" | "nerdfont" };
    case "statusDetail":
      return { statusDetail: value as "minimal" | "project" | "activity" | "verbose" };
    case "statusMaxLength":
      return { statusMaxLength: Number(value) };
    case "statusActivity":
      return { statusShowActivity: value === "Enable" };
    case "notifyStartup":
      return { notifyStartup: value === "Enable" };
    case "notifyRecall":
      return { notifyRecall: value === "Enable" };
    case "notifyRetain":
      return { notifyRetain: value === "Enable" };
  }
}

export function inputDefaultForConfigEditingField(
  fieldId: FieldId,
  config: ResolvedConfig,
  projectBankId: string,
): string {
  switch (fieldId) {
    case "apiKeyEnv":
      return apiKeyEnvName(config) === "not set" ? "HINDSIGHT_API_KEY" : apiKeyEnvName(config);
    case "apiKeyDirect":
      return "";
    case "projectBankId":
      return projectBankId;
    case "projectRetainMission":
      return config.banks.project.retainMission ?? "";
    case "projectReflectMission":
      return config.banks.project.reflectMission ?? "";
    case "projectObservationsMission":
      return config.banks.project.observationsMission ?? "";
    case "globalBankId":
      return config.banks.user.bankId ?? DEFAULT_GLOBAL_BANK_ID;
    case "globalRetainMission":
      return config.banks.user.retainMission ?? "";
    case "globalReflectMission":
      return config.banks.user.reflectMission ?? "";
    case "globalObservationsMission":
      return config.banks.user.observationsMission ?? "";
    case "globalRetainMode":
      return config.userRetain.mode;
    case "timeoutMs":
      return String(config.hindsight.timeoutMs);
    case "recallMaxTokens":
      return String(config.recall.maxTokens);
    case "statusMaxLength":
      return String(config.status.maxLength);
    case "baseUrl":
      return config.hindsight.baseUrl;
    case "queuePath":
      return config.retain.queuePath;
    case "importToolSummaryMaxChars":
      return String(config.import.toolResultSummaryMaxChars);
    case "importManifest":
      return config.import.manifestPath;
    case "importCheckpoint":
      return config.import.checkpointPath;
    default:
      return "";
  }
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
      "User bank",
      config.banks.user.enabled ? (config.banks.user.bankId ?? "missing id") : "disabled",
    ],
    ...(config.banks.project.retainMission ||
    config.banks.project.reflectMission ||
    config.banks.project.observationsMission
      ? [
          ["Project mission overrides", "legacy local config; prefer Hindsight bank config"] as [
            string,
            string,
          ],
        ]
      : []),
    ...(config.banks.user.retainMission ||
    config.banks.user.reflectMission ||
    config.banks.user.observationsMission
      ? [
          ["User mission overrides", "legacy local config; prefer Hindsight bank config"] as [
            string,
            string,
          ],
        ]
      : []),
    ["User retain mode", config.userRetain.mode],
    ["Recall", enabledDisabled(config.recall.enabled)],
    ["Retain", enabledDisabled(config.retain.enabled)],
    ["Retain queue", config.retain.queuePath],
    ["Hindsight API", config.hindsight.baseUrl],
  ];
}
