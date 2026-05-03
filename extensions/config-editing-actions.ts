import type { ResolvedConfig } from "./types.js";
import {
  DEFAULT_GLOBAL_BANK_ID,
  type MemoryProfile,
  type ProjectConfigPatchInput,
} from "./config-writer.js";
import type { FieldId } from "./config-editing-types.js";

function apiKeyEnvName(config: ResolvedConfig): string {
  return config.hindsight.apiKeyRef?.startsWith("env:")
    ? config.hindsight.apiKeyRef.slice(4)
    : "not set";
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
        globalBankId: config.banks.global.bankId ?? DEFAULT_GLOBAL_BANK_ID,
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
    case "importBranches":
      return { importIncludeBranches: value as "current-only" | "all-leaves" };
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
      return config.banks.global.bankId ?? DEFAULT_GLOBAL_BANK_ID;
    case "globalRetainMission":
      return config.banks.global.retainMission ?? "";
    case "globalReflectMission":
      return config.banks.global.reflectMission ?? "";
    case "globalObservationsMission":
      return config.banks.global.observationsMission ?? "";
    case "globalRetainMode":
      return config.globalRetain.mode;
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
    case "importManifest":
      return config.import.manifestPath;
    case "importCheckpoint":
      return config.import.checkpointPath;
    default:
      return "";
  }
}
