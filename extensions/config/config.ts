import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { ResolvedConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { envBool, isRecord, merge, normalizeConfig, validEnvVarName } from "./config-normalize.js";

export { DEFAULT_CONFIG } from "./config-defaults.js";
export { normalizeConfig, validEnvVarName } from "./config-normalize.js";

export function parseJsonWithComments(text: string, source = "config"): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `Invalid JSONC in ${source} at offset ${first.offset}: ${printParseErrorCode(first.error)}`,
    );
  }
  return value as unknown;
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return parseJsonWithComments(readFileSync(path, "utf8"), path);
}

export function readConfigFile(basePath: string): unknown {
  const json = readJson(`${basePath}.json`);
  return json === undefined ? readJson(`${basePath}.jsonc`) : json;
}

function configPath(basePath: string): string | undefined {
  const json = `${basePath}.json`;
  if (existsSync(json)) return json;
  const jsonc = `${basePath}.jsonc`;
  if (existsSync(jsonc)) return jsonc;
  return undefined;
}

function migrateUserMemoryKeys(config: Record<string, unknown>): boolean {
  let changed = false;
  if (isRecord(config.banks)) {
    if ("global" in config.banks) {
      if (isRecord(config.banks.user) && isRecord(config.banks.global)) {
        config.banks.user = { ...config.banks.global, ...config.banks.user };
      } else if (!("user" in config.banks)) config.banks.user = config.banks.global;
      delete config.banks.global;
      changed = true;
    }
  }
  if ("globalRetain" in config) {
    if (isRecord(config.userRetain) && isRecord(config.globalRetain)) {
      config.userRetain = { ...config.globalRetain, ...config.userRetain };
    } else if (!("userRetain" in config)) config.userRetain = config.globalRetain;
    delete config.globalRetain;
    changed = true;
  }
  if (isRecord(config.recall)) {
    if ("globalQueryPreamble" in config.recall) {
      if (!("userQueryPreamble" in config.recall)) {
        config.recall.userQueryPreamble = config.recall.globalQueryPreamble;
      }
      delete config.recall.globalQueryPreamble;
      changed = true;
    }
  }
  return changed;
}

export interface ConfigMigrationResult {
  path: string;
  backupPath: string;
}

let lastConfigMigrationResults: ConfigMigrationResult[] = [];

export function consumeLastConfigMigrationResults(): ConfigMigrationResult[] {
  const results = lastConfigMigrationResults;
  lastConfigMigrationResults = [];
  return results;
}

export function migrateUserMemoryConfigFile(
  path: string,
  now = new Date(),
): ConfigMigrationResult | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = parseJsonWithComments(readFileSync(path, "utf8"), path);
  if (!isRecord(parsed)) return undefined;
  if (!migrateUserMemoryKeys(parsed)) return undefined;
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.bak-${stamp}`;
  copyFileSync(path, backupPath);
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return { path, backupPath };
}

export function migrateUserMemoryConfigFiles(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfigMigrationResult[] {
  const results: ConfigMigrationResult[] = [];
  const home = env.HOME;
  const paths = [
    home ? configPath(join(home, ".pi", "agent", "hindsight")) : undefined,
    configPath(join(cwd, ".pi", "hindsight")),
  ].filter((path): path is string => Boolean(path));
  const now = new Date();
  for (const path of paths) {
    const result = migrateUserMemoryConfigFile(path, now);
    if (result) results.push(result);
  }
  if (results.length) lastConfigMigrationResults = results;
  return results;
}

export function resolveConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  migrateUserMemoryConfigFiles(cwd, env);
  let rawConfig: Record<string, unknown> = {};
  let config = DEFAULT_CONFIG;
  const home = env.HOME;
  const homeConfig = home ? readConfigFile(join(home, ".pi", "agent", "hindsight")) : undefined;
  rawConfig = merge(rawConfig, homeConfig);
  config = merge(config, homeConfig);
  const projectConfig = readConfigFile(join(cwd, ".pi", "hindsight"));
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
  const userBankId = env.PI_HINDSIGHT_USER_BANK_ID || env.PI_HINDSIGHT_GLOBAL_BANK_ID;
  if (userBankId) {
    const patch = {
      banks: { user: { enabled: true, bankId: userBankId } },
    };
    rawConfig = merge(rawConfig, patch);
    config = merge(config, patch);
  }
  const minScores: Record<string, number> = {};
  const semanticFloor =
    env.PI_HINDSIGHT_MIN_SEMANTIC?.trim() === ""
      ? Number.NaN
      : Number(env.PI_HINDSIGHT_MIN_SEMANTIC);
  if (Number.isFinite(semanticFloor)) minScores.semantic = semanticFloor;
  const rerankerFloor =
    env.PI_HINDSIGHT_MIN_RERANKER?.trim() === ""
      ? Number.NaN
      : Number(env.PI_HINDSIGHT_MIN_RERANKER);
  if (Number.isFinite(rerankerFloor)) minScores.reranker = rerankerFloor;
  if (Object.keys(minScores).length) {
    const patch = { recall: { minScores } };
    rawConfig = merge(rawConfig, patch);
    config = merge(config, patch);
  }
  return normalizeConfig(config, rawConfig, env);
}
