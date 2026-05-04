import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { validEnvVarName } from "./config.js";
import { resetPathsForConfigKeys, type ConfigResetKey } from "./config-field-paths.js";

export type MemoryProfile = "project-only" | "project+global" | "global-only";

export type ConfigScope = "project" | "global";

export type ConfigSource = ConfigScope | "env" | "default";
export type { ConfigResetKey } from "./config-field-paths.js";

export const DEFAULT_GLOBAL_BANK_ID = "pi-global";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeBankPatch(
  patch: Record<string, unknown>,
  bank: "project" | "user",
  values: Record<string, unknown>,
): void {
  const banksPatch = isRecord(patch.banks) ? patch.banks : {};
  patch.banks = {
    ...banksPatch,
    [bank]: {
      ...(isRecord(banksPatch[bank]) ? banksPatch[bank] : {}),
      ...values,
    },
  };
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "hindsight.json");
}

export function globalConfigPath(home = process.env.HOME || homedir()): string {
  return join(home, ".pi", "agent", "hindsight.json");
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
  return parsed;
}

export function readProjectConfig(cwd: string): Record<string, unknown> {
  return readConfig(projectConfigPath(cwd));
}

export function readGlobalConfig(home?: string): Record<string, unknown> {
  return readConfig(globalConfigPath(home));
}

export function deepMergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isRecord(value) && isRecord(out[key]) ? deepMergeConfig(out[key], value) : value;
  }
  return out;
}

export interface ProjectConfigPatchInput {
  enabled?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  apiKeyEnvVar?: string;
  directApiKey?: string;
  projectBankId?: string;
  projectRetainMission?: string;
  projectReflectMission?: string;
  projectObservationsMission?: string;
  globalBankId?: string;
  globalRetainMission?: string;
  globalReflectMission?: string;
  globalObservationsMission?: string;
  globalRetainMode?: "explicit-only" | "router";
  enableGlobalBank?: boolean;
  memoryProfile?: MemoryProfile;
  recallEnabled?: boolean;
  recallBudget?: "low" | "mid" | "high";
  recallMaxTokens?: number;
  recallStoreLast?: boolean;
  recallStoreFailures?: boolean;
  retainEnabled?: boolean;
  retainAsync?: boolean;
  retainUpdateMode?: "append" | "replace";
  queuePath?: string;
  importMode?: "curated" | "raw" | "forensic";
  importIncludeBranches?: "current-only" | "all-leaves";
  importManifestPath?: string;
  importCheckpointPath?: string;
  importReplaceExistingDocs?: boolean;
  importResume?: boolean;
  statusStyle?: "off" | "text" | "emoji" | "nerdfont";
  statusDetail?: "minimal" | "project" | "activity" | "verbose";
  statusMaxLength?: number;
  statusShowActivity?: boolean;
  notifyStartup?: boolean;
  notifyRecall?: boolean;
  notifyRetain?: boolean;
  resetDefaults?: ConfigResetKey[];
  scope?: ConfigScope;
}

export function buildProjectConfigDeletes(input: ProjectConfigPatchInput): string[][] {
  return resetPathsForConfigKeys(input.resetDefaults ?? []);
}

export function buildProjectConfigPatch(input: ProjectConfigPatchInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.apiKeyEnvVar && !validEnvVarName(input.apiKeyEnvVar)) {
    throw new Error("apiKeyEnvVar must be an environment variable name");
  }
  if (input.baseUrl || input.timeoutMs !== undefined || input.apiKeyEnvVar || input.directApiKey) {
    patch.hindsight = {
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.apiKeyEnvVar ? { apiKey: { source: "env", name: input.apiKeyEnvVar } } : {}),
      ...(input.directApiKey ? { apiKey: input.directApiKey } : {}),
    };
  }
  if (input.memoryProfile) {
    const globalBankId = input.globalBankId || DEFAULT_GLOBAL_BANK_ID;
    if (input.memoryProfile === "project-only") {
      patch.banks = { project: { enabled: true }, user: { enabled: false } };
    } else if (input.memoryProfile === "project+global") {
      patch.banks = {
        project: { enabled: true },
        user: { enabled: true, bankId: globalBankId },
      };
    } else {
      patch.banks = {
        project: { enabled: false },
        user: { enabled: true, bankId: globalBankId },
      };
    }
  }
  if (input.projectBankId && input.memoryProfile !== "global-only") {
    patch.banks = {
      ...(isRecord(patch.banks) ? patch.banks : {}),
      project: { enabled: true, derive: "manual", bankId: input.projectBankId },
    };
  }
  if (input.projectRetainMission !== undefined) {
    mergeBankPatch(patch, "project", { retainMission: input.projectRetainMission });
  }
  if (input.projectReflectMission !== undefined) {
    mergeBankPatch(patch, "project", { reflectMission: input.projectReflectMission });
  }
  if (input.projectObservationsMission !== undefined) {
    mergeBankPatch(patch, "project", { observationsMission: input.projectObservationsMission });
  }
  if (!input.memoryProfile && (input.globalBankId || input.enableGlobalBank !== undefined)) {
    patch.banks = {
      ...(isRecord(patch.banks) ? patch.banks : {}),
      user: {
        ...(input.enableGlobalBank !== undefined ? { enabled: input.enableGlobalBank } : {}),
        ...(input.globalBankId ? { bankId: input.globalBankId, enabled: true } : {}),
      },
    };
  }
  if (input.globalRetainMission !== undefined) {
    mergeBankPatch(patch, "user", { retainMission: input.globalRetainMission });
  }
  if (input.globalReflectMission !== undefined) {
    mergeBankPatch(patch, "user", { reflectMission: input.globalReflectMission });
  }
  if (input.globalObservationsMission !== undefined) {
    mergeBankPatch(patch, "user", { observationsMission: input.globalObservationsMission });
  }
  if (input.globalRetainMode) {
    patch.userRetain = { mode: input.globalRetainMode };
  }
  if (
    input.recallEnabled !== undefined ||
    input.recallBudget ||
    input.recallMaxTokens !== undefined ||
    input.recallStoreLast !== undefined ||
    input.recallStoreFailures !== undefined
  ) {
    patch.recall = {
      ...(input.recallEnabled !== undefined ? { enabled: input.recallEnabled } : {}),
      ...(input.recallBudget ? { budget: input.recallBudget } : {}),
      ...(input.recallMaxTokens !== undefined ? { maxTokens: input.recallMaxTokens } : {}),
      ...(input.recallStoreLast !== undefined ? { storeLastRecall: input.recallStoreLast } : {}),
      ...(input.recallStoreFailures !== undefined
        ? { storeLastRecallFailures: input.recallStoreFailures }
        : {}),
    };
  }
  if (
    input.queuePath ||
    input.retainEnabled !== undefined ||
    input.retainAsync !== undefined ||
    input.retainUpdateMode
  ) {
    patch.retain = {
      ...(input.retainEnabled !== undefined ? { enabled: input.retainEnabled } : {}),
      ...(input.retainAsync !== undefined ? { async: input.retainAsync } : {}),
      ...(input.retainUpdateMode ? { updateMode: input.retainUpdateMode } : {}),
      ...(input.queuePath ? { queuePath: input.queuePath } : {}),
    };
  }
  if (
    input.importMode ||
    input.importIncludeBranches ||
    input.importManifestPath ||
    input.importCheckpointPath ||
    input.importReplaceExistingDocs !== undefined ||
    input.importResume !== undefined
  ) {
    patch.import = {
      ...(input.importMode ? { mode: input.importMode } : {}),
      ...(input.importIncludeBranches ? { includeBranches: input.importIncludeBranches } : {}),
      ...(input.importManifestPath ? { manifestPath: input.importManifestPath } : {}),
      ...(input.importCheckpointPath ? { checkpointPath: input.importCheckpointPath } : {}),
      ...(input.importReplaceExistingDocs !== undefined
        ? { replaceExistingImportedDocs: input.importReplaceExistingDocs }
        : {}),
      ...(input.importResume !== undefined ? { resume: input.importResume } : {}),
    };
  }
  if (
    input.statusStyle ||
    input.statusDetail ||
    input.statusMaxLength !== undefined ||
    input.statusShowActivity !== undefined
  ) {
    patch.status = {
      ...(input.statusStyle ? { style: input.statusStyle } : {}),
      ...(input.statusDetail ? { detail: input.statusDetail } : {}),
      ...(input.statusMaxLength !== undefined ? { maxLength: input.statusMaxLength } : {}),
      ...(input.statusShowActivity !== undefined ? { showActivity: input.statusShowActivity } : {}),
    };
  }
  if (
    input.notifyStartup !== undefined ||
    input.notifyRecall !== undefined ||
    input.notifyRetain !== undefined
  ) {
    patch.notifications = {
      ...(input.notifyStartup !== undefined ? { startup: input.notifyStartup } : {}),
      ...(input.notifyRecall !== undefined ? { recall: input.notifyRecall } : {}),
      ...(input.notifyRetain !== undefined ? { retain: input.notifyRetain } : {}),
    };
  }
  return patch;
}

function deletePath(config: Record<string, unknown>, path: string[]): void {
  const [head, ...rest] = path;
  if (!head) return;
  if (rest.length === 0) {
    delete config[head];
    return;
  }
  const child = config[head];
  if (isRecord(child)) deletePath(child, rest);
}

async function writeConfig(
  path: string,
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  deletePaths: string[][] = [],
): Promise<{ path: string; config: Record<string, unknown> }> {
  for (const deletePathParts of deletePaths) deletePath(base, deletePathParts);
  const next = deepMergeConfig(base, patch);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { path, config: next };
}

export async function writeProjectConfig(
  cwd: string,
  patch: Record<string, unknown>,
  deletePaths: string[][] = [],
): Promise<{ path: string; config: Record<string, unknown> }> {
  return writeConfig(projectConfigPath(cwd), readProjectConfig(cwd), patch, deletePaths);
}

export async function writeGlobalConfig(
  patch: Record<string, unknown>,
  deletePaths: string[][] = [],
  home?: string,
): Promise<{ path: string; config: Record<string, unknown> }> {
  return writeConfig(globalConfigPath(home), readGlobalConfig(home), patch, deletePaths);
}
