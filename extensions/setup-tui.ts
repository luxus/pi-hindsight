import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { FieldId } from "./config-editing-model.js";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operation-service.js";
import { flushRetainQueueNotifyLevel, formatFlushRetainQueueResult } from "./flush-presenter.js";
import { hasProjectHindsightConfig, runGuidedSetup } from "./guided-setup.js";
import { buildSetupTabs } from "./setup-tui-facts.js";
import { handleMentalModels } from "./setup-tui-mental-models.js";
import { createSetupComponent } from "./setup-tui-render.js";
import { handleDeployment, handleFieldEdit, handleResetFieldAction } from "./setup-tui-actions.js";
import type { SetupActionId, SetupUiState, ThemeLike } from "./setup-tui-types.js";

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
  SetupTemplateChoice,
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

export async function runHindsightSetupTui(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const state: SetupUiState = { tabIndex: 0, selectedByTab: {} };
  if (!hasProjectHindsightConfig(ctx.cwd)) {
    const choice = await ctx.ui.select("No project Hindsight config found", [
      "Guided setup",
      "Open advanced setup",
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
      } else if (action === "mental-models") await handleMentalModels(ctx, deps);
      else if (action === "toggle-advanced") {
        state.showAdvanced = !state.showAdvanced;
        state.selectedByTab = {};
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
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}
