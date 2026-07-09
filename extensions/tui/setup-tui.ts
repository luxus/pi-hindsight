import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { redactError } from "../utils/sanitize.js";
import type { FieldId } from "../config/config-editing-model.js";
import {
  createMemoryOperations,
  type MemoryOperationsDeps,
} from "../operations/memory-operation-service.js";
import {
  flushRetainQueueNotifyLevel,
  formatFlushRetainQueueResult,
} from "../queue/flush-presenter.js";
import { defaultTemplateIdFor, listBankTemplatesForAgentUse } from "../banks/bank-templates.js";
import {
  hasProjectHindsightConfig,
  maybeOfferHistoricalImportForSetup,
  runGuidedSetup,
} from "./guided-setup.js";
import {
  renderBankTemplateApplyResult,
  renderBankTemplateMentalModelDetails,
} from "./bank-template-presentation.js";
import { buildSetupTabs } from "./setup-tui-facts.js";
import { createSetupComponent } from "./setup-tui-render.js";
import { handleDeployment, handleFieldEdit, handleResetFieldAction } from "./setup-tui-actions.js";
import type { SetupActionId, SetupUiState, ThemeLike } from "./setup-tui-types.js";
import { CANCEL } from "./setup-tui-types.js";
import type { SessionMemoryMode } from "../utils/session-memory-meta.js";
import { getSessionFile } from "../utils/session.js";

export { buildRetainReceiptStatusFacts, createSetupComponent } from "./setup-tui-render.js";
export {
  applySetupIntent,
  currentSetupTab,
  normalizeSetupUiState,
  selectedSetupField,
  selectedSetupIndex,
  setupIntentFromInput,
} from "./setup-flow.js";
export type { SetupIntent, SetupResult } from "./setup-flow.js";
export type {
  SetupActionId,
  SetupProfileChoice,
  SetupStep,
  SetupUiState,
  ThemeLike,
} from "./setup-tui-types.js";

async function showSetupTui(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
  state: SetupUiState,
): Promise<SetupActionId | null> {
  const config = deps.getConfig();
  const projectBankId = deps.getProjectBankId();
  const tabs = await buildSetupTabs({ ctx, config, projectBankId, deps, state });
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

async function handleSetMode(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const choice = await ctx.ui.select("Session memory mode", [
    "normal",
    "read-only",
    "ignored",
    CANCEL,
  ]);
  if (!choice || choice === CANCEL) return;
  const sessionFile = getSessionFile(ctx);
  const result = await createMemoryOperations(deps).setSessionMode(
    ctx.cwd,
    sessionFile,
    choice as SessionMemoryMode,
  );
  ctx.ui.notify(`Session memory mode: ${result.meta.mode}`, "info");
}

async function handleNextOptOut(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const sessionFile = getSessionFile(ctx);
  const result = await createMemoryOperations(deps).setNextRetainOff(ctx.cwd, sessionFile);
  ctx.ui.notify(
    `Hindsight will skip automatic retain for the next agent run. nextRetain=${result.meta.nextRetainMode}`,
    "info",
  );
}

async function handleApplyMentalModels(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const operations = createMemoryOperations(deps);
  const config = deps.getConfig();
  const templates = [...listBankTemplatesForAgentUse(config.agentUse)];
  const labels = templates.map(
    (template) => `${template.id} — ${template.label} (${template.target})`,
  );
  const choice = await ctx.ui.select(`Mental model sets for agent use “${config.agentUse}”`, [
    ...labels,
    CANCEL,
  ]);
  if (!choice || choice === CANCEL) return;
  const index = labels.indexOf(choice);
  const template = index >= 0 ? templates[index] : undefined;
  if (!template) {
    ctx.ui.notify(`Unknown template selection: ${choice}`, "warning");
    return;
  }
  const dryRun = await operations.applyBankTemplate({ templateId: template.id, dryRun: true });
  const details = renderBankTemplateMentalModelDetails(dryRun.template);
  const confirmed = await ctx.ui.confirm(
    `Apply ${template.id} to ${dryRun.bankId}?`,
    `${details ? `${details}\n\n` : ""}${renderBankTemplateApplyResult(dryRun)}\n\nThis writes bank config and creates/updates mental models. Continue?`,
  );
  if (!confirmed) return;
  const applied = await operations.applyBankTemplate({ templateId: template.id, dryRun: false });
  ctx.ui.notify(renderBankTemplateApplyResult(applied), "info");
}

async function handleImportSessions(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const config = deps.getConfig();
  const setupProfile = config.banks.project.enabled
    ? config.banks.user.enabled
      ? "project-user"
      : "project-only"
    : config.banks.user.enabled
      ? "user-only"
      : "recall-only";
  await maybeOfferHistoricalImportForSetup({
    ctx,
    operations: createMemoryOperations(deps),
    setupProfile,
    cwd: ctx.cwd,
    projectBankId: deps.getProjectBankId(),
    ...(config.banks.user.bankId ? { globalBankId: config.banks.user.bankId } : {}),
  });
}

async function handleDoctor(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const sessionFile = getSessionFile(ctx);
  const report = await createMemoryOperations(deps).doctor(ctx.cwd, sessionFile);
  ctx.ui.notify(report, "info");
}

async function handleInitConfig(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const result = await createMemoryOperations(deps).init(ctx.cwd);
  ctx.ui.notify(
    `Wrote ${result.path}; project bank ${result.projectBankId}. Mental models: apply from hub (t).`,
    "info",
  );
}

export async function runHindsightSetupTui(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const state: SetupUiState = { tabIndex: 0, selectedByTab: {} };
  if (!hasProjectHindsightConfig(ctx.cwd)) {
    const choice = await ctx.ui.select("No project Hindsight config found", [
      "Guided setup",
      "Open hub",
      "Skip",
    ]);
    if (choice === "Guided setup") await runGuidedSetup({ ctx, deps, cwd: ctx.cwd });
    if (choice === "Skip" || !choice) return;
  }
  while (true) {
    const config = deps.getConfig();
    const projectBankId = deps.getProjectBankId();
    const action = await showSetupTui(ctx, deps, state);
    if (!action || action === "done") return;
    try {
      if (action === "choose-deployment") await handleDeployment(ctx, deps, config);
      else if (action === "guided-setup") await runGuidedSetup({ ctx, deps, cwd: ctx.cwd });
      else if (action === "flush-queue") {
        const result = await createMemoryOperations(deps).flush(ctx.cwd);
        ctx.ui.notify(formatFlushRetainQueueResult(result), flushRetainQueueNotifyLevel(result));
      } else if (action === "set-mode") await handleSetMode(ctx, deps);
      else if (action === "next-opt-out") await handleNextOptOut(ctx, deps);
      else if (action === "apply-mental-models") await handleApplyMentalModels(ctx, deps);
      else if (action === "import-sessions") await handleImportSessions(ctx, deps);
      else if (action === "run-doctor") await handleDoctor(ctx, deps);
      else if (action === "init-config") await handleInitConfig(ctx, deps);
      else if (action === "toggle-advanced") {
        state.showAdvanced = !state.showAdvanced;
        state.selectedByTab = {};
        state.tabIndex = 0;
      } else if (action.startsWith("reset:")) {
        await handleResetFieldAction({
          ctx,
          deps,
          config,
          projectBankId,
          fieldId: action.slice("reset:".length) as FieldId,
        });
      } else
        await handleFieldEdit({ fieldId: action as FieldId, ctx, deps, config, projectBankId });
    } catch (error) {
      ctx.ui.notify(redactError(error), "error");
    }
  }
}

/** Shared helper for guided setup: default template id for active agent use. */
export function guidedMentalModelTemplateId(
  target: "project" | "user",
  agentUse: "coding" | "conversation",
): string {
  return defaultTemplateIdFor(target, agentUse);
}
