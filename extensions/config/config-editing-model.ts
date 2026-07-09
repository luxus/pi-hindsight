import type { ResolvedConfig } from "../types.js";
import { readGlobalConfig, readProjectConfig } from "./config-writer.js";
import type {
  ConfigEditingField,
  ConfigEditingTab,
  ConfigLayers,
  TabId,
} from "./config-editing-registry.js";
import {
  buildConfigEditingFieldsFromRegistry,
  buildStatusFacts,
} from "./config-editing-registry.js";

export type {
  ConfigEditingField,
  ConfigEditingKind,
  ConfigEditingTab,
  ConfigLayers,
  FieldId,
  TabId,
} from "./config-editing-registry.js";
export {
  enabledDisabled,
  inputDefaultForConfigEditingField,
  parseConfigEditingFieldInput,
  patchForConfigEditingField,
} from "./config-editing-registry.js";

export function readConfigLayers(cwd: string): ConfigLayers {
  return { project: readProjectConfig(cwd), global: readGlobalConfig(), env: process.env };
}

export function buildConfigEditingFields(
  config: ResolvedConfig,
  projectBankId: string,
  layers: ConfigLayers,
): ConfigEditingField[] {
  return buildConfigEditingFieldsFromRegistry(config, projectBankId, layers);
}

export function buildConfigEditingTabs(
  config: ResolvedConfig,
  projectBankId: string,
  layers: ConfigLayers,
  statusFacts: Array<[string, string]> = [],
  options: { showAdvanced?: boolean } = {},
): ConfigEditingTab[] {
  const fields = buildConfigEditingFields(config, projectBankId, layers);
  // Default hub is Status only; advanced unlocks full settings tabs.
  const ids: TabId[] = options.showAdvanced
    ? ["Status", "Connection", "Banks", "Recall", "Retain", "Import", "UI"]
    : ["Status"];
  return ids.map((id) => ({
    id,
    fields:
      id === "Status"
        ? []
        : fields.filter((field) => field.tab === id && (options.showAdvanced || !field.advanced)),
    ...(id === "Status" ? { facts: buildStatusFacts(config, projectBankId, statusFacts) } : {}),
  }));
}
