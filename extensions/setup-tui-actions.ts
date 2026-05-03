import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ResolvedConfig } from "./types.js";
import {
  buildConfigEditingFields,
  inputDefaultForConfigEditingField,
  parseConfigEditingFieldInput,
  patchForConfigEditingField,
  readConfigLayers,
  type ConfigEditingField,
  type FieldId,
} from "./config-editing-model.js";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operation-service.js";
import { type ConfigScope, type ProjectConfigPatchInput } from "./config-writer.js";
import { CANCEL } from "./setup-tui-types.js";

const LOCAL_EMBED_GUIDANCE = [
  "Local hindsight-embed guidance:",
  "uvx hindsight-embed@latest profile create pi --port 8888",
  "uvx hindsight-embed@latest -p pi bank create <bank-id>",
  "uvx hindsight-embed@latest -p pi ui start",
].join("\n");

async function writeAndReload(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  patch: ProjectConfigPatchInput,
  scope: ConfigScope = "project",
): Promise<void> {
  const result = await createMemoryOperations(deps).configure(ctx.cwd, { ...patch, scope });
  ctx.ui.notify(`Saved ${scope} config to ${result.path}; setup view reloaded.`, "info");
}

async function resetField(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  field: ConfigEditingField,
  scope: ConfigScope = "project",
): Promise<void> {
  await writeAndReload(ctx, deps, { resetDefaults: [field.resetKey] }, scope);
}

function settingPrompt(field: ConfigEditingField): string {
  return [
    field.label,
    field.description,
    `Effective: ${field.value} (${field.source ?? "default"})`,
    `Environment: ${field.envValue ?? "not set"}`,
    `Project: ${field.projectValue ?? "not set"}`,
    `Global: ${field.globalValue ?? "not set"}`,
    `Default: ${field.defaultValue}`,
    field.source === "env"
      ? "Environment currently wins; project/global edits save for when env override is removed."
      : "Changes save immediately.",
  ].join("\n");
}

function scopeLabel(scope: ConfigScope): string {
  return scope === "project" ? "Project" : "Global";
}

function withScopedValues(field: ConfigEditingField, values: string[]): string[] {
  const scoped = (field.editableScopes ?? ["project"]).flatMap((scope) =>
    values.map((value) => `${scopeLabel(scope)}: ${value}`),
  );
  const resets = (field.editableScopes ?? ["project"]).flatMap((scope) => {
    if (scope === "project" && field.projectValue !== undefined) return ["Remove project override"];
    if (scope === "global" && field.globalValue !== undefined) return ["Remove global override"];
    return [];
  });
  return [...scoped, ...resets, CANCEL];
}

function parseScopedAction(action: string): { scope: ConfigScope; value: string } | undefined {
  if (action.startsWith("Project: "))
    return { scope: "project", value: action.slice("Project: ".length) };
  if (action.startsWith("Global: "))
    return { scope: "global", value: action.slice("Global: ".length) };
  return undefined;
}

async function chooseScope(
  ctx: ExtensionCommandContext,
  field: ConfigEditingField,
): Promise<ConfigScope | undefined> {
  const scopes = field.editableScopes ?? ["project"];
  if (scopes.length === 1) return scopes[0];
  const value = await ctx.ui.select(settingPrompt(field), scopes.map(scopeLabel).concat(CANCEL));
  if (!value || value === CANCEL) return undefined;
  return value === "Global" ? "global" : "project";
}

async function handleResetAction(
  action: string,
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  field: ConfigEditingField,
): Promise<boolean> {
  if (action === "Remove project override") {
    await resetField(ctx, deps, field, "project");
    return true;
  }
  if (action === "Remove global override") {
    await resetField(ctx, deps, field, "global");
    return true;
  }
  return false;
}

async function promptScopedValue(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  field: ConfigEditingField,
): Promise<{ scope: ConfigScope; value: string } | undefined> {
  if (field.kind === "boolean" || field.kind === "select") {
    const values = field.kind === "boolean" ? ["Enable", "Disable"] : (field.choices ?? []);
    const action = await ctx.ui.select(settingPrompt(field), withScopedValues(field, values));
    if (!action || action === CANCEL) return undefined;
    if (await handleResetAction(action, ctx, deps, field)) return undefined;
    return parseScopedAction(action);
  }

  const scope = await chooseScope(ctx, field);
  if (!scope) return undefined;
  const value = await ctx.ui.input(
    settingPrompt(field),
    inputDefaultForConfigEditingField(field.id, deps.getConfig(), deps.getProjectBankId()),
  );
  const parsed = parseConfigEditingFieldInput(field, value);
  if (parsed === undefined) return undefined;
  return { scope, value: parsed };
}

export async function handleResetFieldAction(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  config: ResolvedConfig;
  projectBankId: string;
  fieldId: FieldId;
}): Promise<void> {
  const field = buildConfigEditingFields(
    args.config,
    args.projectBankId,
    readConfigLayers(args.ctx.cwd),
  ).find((item) => item.id === args.fieldId);
  if (field) {
    await resetField(args.ctx, args.deps, field, field.source === "global" ? "global" : "project");
  }
}

export async function handleFieldEdit(args: {
  fieldId: FieldId;
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  config: ResolvedConfig;
  projectBankId: string;
}): Promise<void> {
  const layers = readConfigLayers(args.ctx.cwd);
  const field = buildConfigEditingFields(args.config, args.projectBankId, layers).find(
    (item) => item.id === args.fieldId,
  );
  if (!field) return;

  const scoped = await promptScopedValue(args.ctx, args.deps, field);
  if (!scoped) return;
  const patch = patchForConfigEditingField(field.id, scoped.value, args.config);
  if (patch) await writeAndReload(args.ctx, args.deps, patch, scoped.scope);
}

export async function handleDeployment(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  config: ResolvedConfig,
): Promise<void> {
  const value = await ctx.ui.select("Hindsight deployment", [
    "Hindsight Cloud",
    "Existing local/external API",
    "Local hindsight-embed guidance",
    CANCEL,
  ]);
  if (value === "Hindsight Cloud") {
    const baseUrl = await ctx.ui.input("Hindsight Cloud base URL", config.hindsight.baseUrl);
    if (baseUrl) await writeAndReload(ctx, deps, { baseUrl: baseUrl.trim() });
    const envName = await ctx.ui.input("API key env var name", "HINDSIGHT_API_KEY");
    if (envName) await writeAndReload(ctx, deps, { apiKeyEnvVar: envName.trim() });
  } else if (value === "Existing local/external API") {
    const baseUrl = await ctx.ui.input("Hindsight API base URL", config.hindsight.baseUrl);
    if (baseUrl) await writeAndReload(ctx, deps, { baseUrl: baseUrl.trim() });
  } else if (value === "Local hindsight-embed guidance") {
    ctx.ui.notify(LOCAL_EMBED_GUIDANCE, "info");
    const useDefault = await ctx.ui.select("Set API URL to http://localhost:8888?", [
      "Yes",
      "No",
      CANCEL,
    ]);
    if (useDefault === "Yes") await writeAndReload(ctx, deps, { baseUrl: "http://localhost:8888" });
  }
}
