export type FieldId =
  | "enabled"
  | "baseUrl"
  | "apiKeyEnv"
  | "apiKeyDirect"
  | "timeoutMs"
  | "memoryProfile"
  | "projectBankId"
  | "projectRetainMission"
  | "projectReflectMission"
  | "projectObservationsMission"
  | "globalBankEnabled"
  | "globalBankId"
  | "globalRetainMission"
  | "globalReflectMission"
  | "globalObservationsMission"
  | "globalRetainMode"
  | "recallEnabled"
  | "recallBudget"
  | "recallMaxTokens"
  | "recallStoreLast"
  | "recallStoreFailures"
  | "retainEnabled"
  | "retainAsync"
  | "queuePath"
  | "importMode"
  | "importBranches"
  | "importManifest"
  | "importCheckpoint"
  | "importReplaceExisting"
  | "importResume"
  | "statusStyle"
  | "statusDetail"
  | "statusMaxLength"
  | "statusActivity"
  | "notifyStartup"
  | "notifyRecall"
  | "notifyRetain";

export const CONFIG_FIELD_PATHS: Record<FieldId, string[]> = {
  enabled: ["enabled"],
  baseUrl: ["hindsight", "baseUrl"],
  apiKeyEnv: ["hindsight", "apiKey"],
  apiKeyDirect: ["hindsight", "apiKey"],
  timeoutMs: ["hindsight", "timeoutMs"],
  memoryProfile: ["banks", "project", "enabled"],
  projectBankId: ["banks", "project", "bankId"],
  projectRetainMission: ["banks", "project", "retainMission"],
  projectReflectMission: ["banks", "project", "reflectMission"],
  projectObservationsMission: ["banks", "project", "observationsMission"],
  globalBankEnabled: ["banks", "user", "enabled"],
  globalBankId: ["banks", "user", "bankId"],
  globalRetainMission: ["banks", "user", "retainMission"],
  globalReflectMission: ["banks", "user", "reflectMission"],
  globalObservationsMission: ["banks", "user", "observationsMission"],
  globalRetainMode: ["userRetain", "mode"],
  recallEnabled: ["recall", "enabled"],
  recallBudget: ["recall", "budget"],
  recallMaxTokens: ["recall", "maxTokens"],
  recallStoreLast: ["recall", "storeLastRecall"],
  recallStoreFailures: ["recall", "storeLastRecallFailures"],
  retainEnabled: ["retain", "enabled"],
  retainAsync: ["retain", "async"],
  queuePath: ["retain", "queuePath"],
  importMode: ["import", "mode"],
  importBranches: ["import", "includeBranches"],
  importManifest: ["import", "manifestPath"],
  importCheckpoint: ["import", "checkpointPath"],
  importReplaceExisting: ["import", "replaceExistingImportedDocs"],
  importResume: ["import", "resume"],
  statusStyle: ["status", "style"],
  statusDetail: ["status", "detail"],
  statusMaxLength: ["status", "maxLength"],
  statusActivity: ["status", "showActivity"],
  notifyStartup: ["notifications", "startup"],
  notifyRecall: ["notifications", "recall"],
  notifyRetain: ["notifications", "retain"],
};

export const CONFIG_RESET_PATHS = {
  enabled: [["enabled"]],
  "hindsight.baseUrl": [["hindsight", "baseUrl"]],
  "hindsight.timeoutMs": [["hindsight", "timeoutMs"]],
  "hindsight.apiKey": [
    ["hindsight", "apiKey"],
    ["hindsight", "apiKeyRef"],
  ],
  "banks.profile": [
    ["banks", "project", "enabled"],
    ["banks", "user", "enabled"],
    ["banks", "global", "enabled"],
  ],
  "banks.project.bankId": [
    ["banks", "project", "bankId"],
    ["banks", "project", "derive"],
  ],
  "banks.project.missions": [
    ["banks", "project", "mission"],
    ["banks", "project", "retainMission"],
    ["banks", "project", "reflectMission"],
    ["banks", "project", "observationsMission"],
  ],
  "banks.project.retainMission": [["banks", "project", "retainMission"]],
  "banks.project.reflectMission": [["banks", "project", "reflectMission"]],
  "banks.project.observationsMission": [["banks", "project", "observationsMission"]],
  "banks.global.enabled": [
    ["banks", "user", "enabled"],
    ["banks", "global", "enabled"],
  ],
  "banks.global.bankId": [
    ["banks", "user", "bankId"],
    ["banks", "global", "bankId"],
  ],
  "banks.global.missions": [
    ["banks", "user", "mission"],
    ["banks", "user", "retainMission"],
    ["banks", "user", "reflectMission"],
    ["banks", "user", "observationsMission"],
    ["banks", "global", "mission"],
    ["banks", "global", "retainMission"],
    ["banks", "global", "reflectMission"],
    ["banks", "global", "observationsMission"],
  ],
  "banks.global.retainMission": [
    ["banks", "user", "retainMission"],
    ["banks", "global", "retainMission"],
  ],
  "banks.global.reflectMission": [
    ["banks", "user", "reflectMission"],
    ["banks", "global", "reflectMission"],
  ],
  "banks.global.observationsMission": [
    ["banks", "user", "observationsMission"],
    ["banks", "global", "observationsMission"],
  ],
  "globalRetain.mode": [
    ["userRetain", "mode"],
    ["globalRetain", "mode"],
  ],
  "recall.enabled": [["recall", "enabled"]],
  "recall.budget": [["recall", "budget"]],
  "recall.maxTokens": [["recall", "maxTokens"]],
  "recall.storeLastRecall": [["recall", "storeLastRecall"]],
  "recall.storeLastRecallFailures": [["recall", "storeLastRecallFailures"]],
  "retain.enabled": [["retain", "enabled"]],
  "retain.async": [["retain", "async"]],
  "retain.queuePath": [["retain", "queuePath"]],
  "import.mode": [["import", "mode"]],
  "import.includeBranches": [["import", "includeBranches"]],
  "import.manifestPath": [["import", "manifestPath"]],
  "import.checkpointPath": [["import", "checkpointPath"]],
  "import.replaceExistingImportedDocs": [["import", "replaceExistingImportedDocs"]],
  "import.resume": [["import", "resume"]],
  "status.style": [["status", "style"]],
  "status.detail": [["status", "detail"]],
  "status.maxLength": [["status", "maxLength"]],
  "status.showActivity": [["status", "showActivity"]],
  "notifications.startup": [["notifications", "startup"]],
  "notifications.recall": [["notifications", "recall"]],
  "notifications.retain": [["notifications", "retain"]],
} as const satisfies Record<string, readonly (readonly string[])[]>;

export type ConfigResetKey = keyof typeof CONFIG_RESET_PATHS;

export const CONFIG_FIELD_RESET_KEYS: Record<FieldId, ConfigResetKey> = {
  enabled: "enabled",
  baseUrl: "hindsight.baseUrl",
  apiKeyEnv: "hindsight.apiKey",
  apiKeyDirect: "hindsight.apiKey",
  timeoutMs: "hindsight.timeoutMs",
  memoryProfile: "banks.profile",
  projectBankId: "banks.project.bankId",
  projectRetainMission: "banks.project.retainMission",
  projectReflectMission: "banks.project.reflectMission",
  projectObservationsMission: "banks.project.observationsMission",
  globalBankEnabled: "banks.global.enabled",
  globalBankId: "banks.global.bankId",
  globalRetainMission: "banks.global.retainMission",
  globalReflectMission: "banks.global.reflectMission",
  globalObservationsMission: "banks.global.observationsMission",
  globalRetainMode: "globalRetain.mode",
  recallEnabled: "recall.enabled",
  recallBudget: "recall.budget",
  recallMaxTokens: "recall.maxTokens",
  recallStoreLast: "recall.storeLastRecall",
  recallStoreFailures: "recall.storeLastRecallFailures",
  retainEnabled: "retain.enabled",
  retainAsync: "retain.async",
  queuePath: "retain.queuePath",
  importMode: "import.mode",
  importBranches: "import.includeBranches",
  importManifest: "import.manifestPath",
  importCheckpoint: "import.checkpointPath",
  importReplaceExisting: "import.replaceExistingImportedDocs",
  importResume: "import.resume",
  statusStyle: "status.style",
  statusDetail: "status.detail",
  statusMaxLength: "status.maxLength",
  statusActivity: "status.showActivity",
  notifyStartup: "notifications.startup",
  notifyRecall: "notifications.recall",
  notifyRetain: "notifications.retain",
};

export function resetPathsForConfigKeys(keys: ConfigResetKey[]): string[][] {
  return keys.flatMap((key) => CONFIG_RESET_PATHS[key].map((path) => [...path]));
}
