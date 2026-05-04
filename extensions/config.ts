import { join } from "node:path";
import type { ResolvedConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { readConfigFile } from "./config-json.js";
import { migrateUserMemoryConfigFiles } from "./config-migration.js";
import { normalizeConfig } from "./config-normalize.js";
import { envBool, merge, validEnvVarName } from "./config-utils.js";

export { DEFAULT_CONFIG } from "./config-defaults.js";
export { normalizeConfig } from "./config-normalize.js";
export { parseJsonWithComments, readConfigFile, readJson } from "./config-json.js";
export { validEnvVarName } from "./config-utils.js";

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
  return normalizeConfig(config, rawConfig, env);
}
