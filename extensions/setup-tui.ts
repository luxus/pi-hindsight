import { DynamicBorder, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";
import type { ResolvedConfig } from "./types.js";
import {
  buildConfigEditingFields,
  buildConfigEditingTabs,
  inputDefaultForConfigEditingField,
  patchForConfigEditingField,
  readConfigLayers,
  type ConfigEditingField,
  type ConfigEditingTab,
  type FieldId,
  type TabId,
} from "./config-editing-model.js";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operation-service.js";
import { type ConfigScope, type ProjectConfigPatchInput } from "./config-writer.js";
import { collectStatusHealthFacts } from "./status-health.js";
import { listRetainReceipts, type RetainReceipt } from "./retain-receipts.js";

type Deps = MemoryOperationsDeps;

type SetupActionId =
  | FieldId
  | `reset:${FieldId}`
  | "choose-deployment"
  | "toggle-advanced"
  | "done";

type SetupUiState = {
  tabIndex: number;
  selectedByTab: Partial<Record<TabId, number>>;
  showAdvanced?: boolean;
};

type ThemeLike = {
  fg(
    color: "accent" | "muted" | "dim" | "success" | "error" | "warning" | "borderAccent" | "text",
    text: string,
  ): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
};

const CANCEL = "Cancel";
const MIN_BODY_LINES = 30;

const RECEIPT_FACT_LIMIT = 3;

const LOCAL_EMBED_GUIDANCE = [
  "Local hindsight-embed guidance:",
  "uvx hindsight-embed@latest profile create pi --port 8888",
  "uvx hindsight-embed@latest -p pi bank create <bank-id>",
  "uvx hindsight-embed@latest -p pi ui start",
].join("\n");

function parsePositiveInt(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${field} must be a positive integer`);
  return parsed;
}

async function writeAndReload(
  ctx: ExtensionCommandContext,
  deps: Deps,
  patch: ProjectConfigPatchInput,
  scope: ConfigScope = "project",
): Promise<void> {
  const result = await createMemoryOperations(deps).configure(ctx.cwd, { ...patch, scope });
  ctx.ui.notify(`Saved ${scope} config to ${result.path}; setup view reloaded.`, "info");
}

function fitColumns(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (width < 40) return truncateToWidth(`${left} ${right}`, width);
  const rightWidth = Math.min(Math.max(12, visibleWidth(right)), Math.floor(width * 0.38));
  const leftWidth = Math.max(1, width - rightWidth - 1);
  return `${truncateToWidth(left, leftWidth)} ${truncateToWidth(right, rightWidth)}`;
}

function borderLine(
  width: number,
  left: string,
  fill: string,
  right: string,
  theme: ThemeLike,
): string {
  return theme.fg("borderAccent", `${left}${fill.repeat(Math.max(0, width - 2))}${right}`);
}

function padVisibleRight(content: string, width: number): string {
  const truncated = truncateToWidth(content, width);
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function boxed(content: string, width: number, theme: ThemeLike): string {
  if (width < 2) return truncateToWidth(content, width);
  return `${theme.fg("borderAccent", "│")}${padVisibleRight(content, width - 2)}${theme.fg("borderAccent", "│")}`;
}

function shortDocumentId(documentId: string): string {
  const parts = documentId.split(":");
  if (parts[0] === "pi-explicit" && parts.length >= 3) return `${parts[0]}:${parts[2]}`;
  return documentId;
}

function wrapWords(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function buildRetainReceiptStatusFacts(receipts: RetainReceipt[]): Array<[string, string]> {
  if (receipts.length === 0) return [["Retain receipts", "none"]];
  return receipts
    .slice(0, RECEIPT_FACT_LIMIT)
    .map((receipt, index) => [
      index === 0 ? "Recent retain" : `Recent retain ${index + 1}`,
      `${receipt.bankId} ${shortDocumentId(receipt.documentId)}`,
    ]);
}

export function createSetupComponent(
  tabs: ConfigEditingTab[],
  theme: ThemeLike,
  state: SetupUiState,
  done: (action: SetupActionId | null) => void,
): Component {
  state.tabIndex = Math.min(Math.max(0, state.tabIndex), Math.max(0, tabs.length - 1));

  function currentTab(): ConfigEditingTab {
    return tabs[state.tabIndex] ?? tabs[0]!;
  }

  function selectedIndex(): number {
    const tab = currentTab();
    return Math.min(state.selectedByTab[tab.id] ?? 0, Math.max(0, tab.fields.length - 1));
  }

  function setSelectedIndex(index: number): void {
    state.selectedByTab[currentTab().id] = index;
  }

  function selectedField(): ConfigEditingField | undefined {
    return currentTab().fields[selectedIndex()];
  }

  function moveTab(delta: number): void {
    state.tabIndex = (state.tabIndex + delta + tabs.length) % tabs.length;
    setSelectedIndex(selectedIndex());
  }

  function moveSelection(delta: number): void {
    const fields = currentTab().fields;
    if (fields.length === 0) return;
    setSelectedIndex((selectedIndex() + delta + fields.length) % fields.length);
  }

  return {
    render(width: number): string[] {
      const tab = currentTab();
      const lines: string[] = [];
      const innerWidth = Math.max(0, width - 2);
      const changedCount = tabs.reduce(
        (count, item) => count + item.fields.filter((field) => field.changed).length,
        0,
      );
      const horizontal = new DynamicBorder((s: string) => theme.fg("borderAccent", s));

      lines.push(...horizontal.render(width));
      lines.push(borderLine(width, "╭", "─", "╮", theme));
      lines.push(
        boxed(
          ` ${theme.fg("accent", theme.bold("Hindsight setup"))} ${theme.fg("dim", "saved immediately after edit · changed values marked *")}`,
          width,
          theme,
        ),
      );
      lines.push(
        boxed(` ${theme.fg("dim", `${changedCount} changed from defaults`)}`, width, theme),
      );
      lines.push(boxed("", width, theme));

      const tabLine = tabs
        .map((item, index) => {
          const dirty = item.fields.some((field) => field.changed) ? "*" : "";
          const label = ` ${item.id}${dirty} `;
          return index === state.tabIndex
            ? theme.bg("selectedBg", theme.fg("accent", theme.bold(label)))
            : theme.fg("muted", label);
        })
        .join(" ");
      lines.push(boxed(tabLine, width, theme));
      lines.push(boxed("", width, theme));

      lines.push(
        boxed(
          theme.fg(
            "accent",
            theme.bold(tab.id === "Status" ? "Memory status" : `${tab.id} settings`),
          ),
          width,
          theme,
        ),
      );
      if (tab.facts) {
        for (const [label, value] of tab.facts) {
          lines.push(
            boxed(
              fitColumns(
                `   ${theme.fg("muted", `${label}:`)}`,
                theme.fg("text", value),
                innerWidth,
              ),
              width,
              theme,
            ),
          );
        }
      } else {
        lines.push(
          boxed(theme.fg("dim", fitColumns("Setting", "Value", innerWidth)), width, theme),
        );
      }

      for (const [index, field] of tab.fields.entries()) {
        const isSelected = index === selectedIndex();
        const marker = isSelected ? theme.fg("accent", "→") : " ";
        const dirty = field.changed ? theme.fg("warning", "*") : " ";
        const label = isSelected
          ? theme.fg("accent", theme.bold(field.label))
          : theme.fg("text", field.label);
        const rawValue = `${field.value} [${field.source ?? "default"}]`;
        const value = field.changed ? theme.fg("warning", rawValue) : theme.fg("text", rawValue);
        lines.push(
          boxed(fitColumns(`${marker}${dirty} ${label}`, value, innerWidth), width, theme),
        );
      }

      const detailField = selectedField();
      if (detailField) {
        lines.push(boxed("", width, theme));
        lines.push(boxed(theme.fg("accent", theme.bold("Details")), width, theme));
        const details = [
          detailField.description,
          `Default: ${detailField.defaultValue}`,
          ...(detailField.projectValue ? [`Project: ${detailField.projectValue}`] : []),
          ...(detailField.globalValue ? [`Global: ${detailField.globalValue}`] : []),
          ...(detailField.envValue ? [`Env: ${detailField.envValue}`] : []),
        ];
        for (const detail of details) {
          for (const line of wrapWords(detail, innerWidth - 3)) {
            lines.push(boxed(`   ${theme.fg("dim", line)}`, width, theme));
          }
        }
      }

      while (lines.length < MIN_BODY_LINES) lines.push(boxed("", width, theme));

      lines.push(
        boxed(
          theme.fg(
            "dim",
            ` h/l or </> tabs · j/k move · enter edit · r reset · a advanced ${state.showAdvanced ? "on" : "off"} · d deployment · q close `,
          ),
          width,
          theme,
        ),
      );
      lines.push(borderLine(width, "╰", "─", "╯", theme));
      lines.push(...horizontal.render(width));
      return lines.map((line) => truncateToWidth(line, width));
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape) || data === "q") {
        done(null);
        return;
      }
      if (data === "d") {
        done("choose-deployment");
        return;
      }
      if (matchesKey(data, Key.left) || data === "h" || data === "<") {
        moveTab(-1);
        return;
      }
      if (matchesKey(data, Key.right) || data === "l" || data === ">") {
        moveTab(1);
        return;
      }
      if (matchesKey(data, Key.up) || data === "k") {
        moveSelection(-1);
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        moveSelection(1);
        return;
      }
      if (data === "r") {
        const field = selectedField();
        if (field?.changed) done(`reset:${field.id}`);
        return;
      }
      if (data === "a") {
        done("toggle-advanced");
        return;
      }
      if (matchesKey(data, Key.enter)) {
        done(selectedField()?.id ?? null);
      }
    },
    invalidate(): void {},
  };
}

async function showSetupTui(
  ctx: ExtensionCommandContext,
  config: ResolvedConfig,
  projectBankId: string,
  deps: Deps,
  state: SetupUiState,
): Promise<SetupActionId | null> {
  const statusFacts = await collectStatusHealthFacts({
    client: deps.getClient(),
    config,
    projectBankId,
  });
  const receiptFacts = buildRetainReceiptStatusFacts(
    await listRetainReceipts(ctx.cwd, RECEIPT_FACT_LIMIT),
  );
  const tabs = buildConfigEditingTabs(
    config,
    projectBankId,
    readConfigLayers(ctx.cwd),
    [...statusFacts, ...receiptFacts],
    {
      showAdvanced: Boolean(state.showAdvanced),
    },
  );
  return ctx.ui.custom<SetupActionId | null>((tui, theme, _keybindings, done) => {
    const component = createSetupComponent(tabs, theme as ThemeLike, state, done);
    return {
      render: (width: number) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data: string) => {
        component.handleInput?.(data);
        tui.requestRender();
      },
    };
  });
}

async function resetField(
  ctx: ExtensionCommandContext,
  deps: Deps,
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
  deps: Deps,
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
  deps: Deps,
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
  if (!value) return undefined;
  if (field.kind === "positive-int" && parsePositiveInt(value, field.id) === undefined) {
    return undefined;
  }
  return { scope, value };
}

async function handleFieldEdit(
  fieldId: FieldId,
  ctx: ExtensionCommandContext,
  deps: Deps,
  config: ResolvedConfig,
  projectBankId: string,
): Promise<void> {
  const layers = readConfigLayers(ctx.cwd);
  const field = buildConfigEditingFields(config, projectBankId, layers).find(
    (item) => item.id === fieldId,
  );
  if (!field) return;

  const scoped = await promptScopedValue(ctx, deps, field);
  if (!scoped) return;
  const patch = patchForConfigEditingField(field.id, scoped.value, config);
  if (patch) await writeAndReload(ctx, deps, patch, scoped.scope);
}

async function handleDeployment(
  ctx: ExtensionCommandContext,
  deps: Deps,
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

export async function runHindsightSetupTui(
  ctx: ExtensionCommandContext,
  deps: Deps,
): Promise<void> {
  const state: SetupUiState = { tabIndex: 0, selectedByTab: {} };
  while (true) {
    const config = deps.getConfig();
    const projectBankId = deps.getProjectBankId();
    const action = await showSetupTui(ctx, config, projectBankId, deps, state);
    if (!action || action === "done") return;
    try {
      if (action === "choose-deployment") await handleDeployment(ctx, deps, config);
      else if (action === "toggle-advanced") {
        state.showAdvanced = !state.showAdvanced;
        state.selectedByTab = {};
      } else if (action.startsWith("reset:")) {
        const fieldId = action.slice("reset:".length) as FieldId;
        const field = buildConfigEditingFields(
          config,
          projectBankId,
          readConfigLayers(ctx.cwd),
        ).find((item) => item.id === fieldId);
        if (field)
          await resetField(ctx, deps, field, field.source === "global" ? "global" : "project");
      } else await handleFieldEdit(action as FieldId, ctx, deps, config, projectBankId);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}
