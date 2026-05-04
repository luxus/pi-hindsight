import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonWithComments } from "./config-json.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
