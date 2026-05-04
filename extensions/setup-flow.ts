import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { ConfigEditingField, ConfigEditingTab } from "./config-editing-model.js";
import type {
  SetupActionId,
  SetupProfileChoice,
  SetupStep,
  SetupTemplateChoice,
  SetupUiState,
} from "./setup-tui-types.js";

export type SetupIntent =
  | { type: "close" }
  | { type: "chooseDeployment" }
  | { type: "guidedSetup" }
  | { type: "flushQueue" }
  | { type: "mentalModels" }
  | { type: "toggleAdvanced" }
  | { type: "moveTab"; delta: number }
  | { type: "moveSelection"; delta: number }
  | { type: "resetSelectedField" }
  | { type: "editSelectedField" }
  | { type: "startGuidedSetup" }
  | { type: "chooseProfile"; profile: SetupProfileChoice }
  | { type: "chooseTemplate"; template: SetupTemplateChoice }
  | { type: "back" }
  | { type: "finish" };

export type SetupResult =
  | { kind: "state"; state: SetupUiState }
  | { kind: "action"; action: SetupActionId | null; state: SetupUiState };

function defaultStep(step: SetupStep | undefined): SetupStep {
  return step ?? "config";
}

function normalizedTabIndex(tabs: ConfigEditingTab[], tabIndex: number): number {
  if (tabs.length === 0) return 0;
  return Math.min(Math.max(0, tabIndex), tabs.length - 1);
}

function selectedIndexForTab(tab: ConfigEditingTab | undefined, state: SetupUiState): number {
  if (!tab) return 0;
  return Math.min(state.selectedByTab[tab.id] ?? 0, Math.max(0, tab.fields.length - 1));
}

function withState(state: SetupUiState): SetupResult {
  return { kind: "state", state };
}

function withAction(action: SetupActionId | null, state: SetupUiState): SetupResult {
  return { kind: "action", action, state };
}

function nextStep(step: SetupStep): SetupStep {
  if (step === "profile") return "banks";
  if (step === "banks") return "template";
  if (step === "template") return "review";
  if (step === "review") return "done";
  return step;
}

function previousStep(step: SetupStep): SetupStep {
  if (step === "profile") return "config";
  if (step === "banks") return "profile";
  if (step === "template") return "banks";
  if (step === "review") return "template";
  if (step === "done") return "review";
  return step;
}

export function normalizeSetupUiState(tabs: ConfigEditingTab[], state: SetupUiState): SetupUiState {
  const tabIndex = normalizedTabIndex(tabs, state.tabIndex);
  const tab = tabs[tabIndex];
  const selectedByTab = { ...state.selectedByTab };
  if (tab) selectedByTab[tab.id] = selectedIndexForTab(tab, { ...state, tabIndex, selectedByTab });
  return {
    ...state,
    step: defaultStep(state.step),
    tabIndex,
    selectedByTab,
  };
}

export function currentSetupTab(
  tabs: ConfigEditingTab[],
  state: SetupUiState,
): ConfigEditingTab | undefined {
  return tabs[normalizedTabIndex(tabs, state.tabIndex)];
}

export function selectedSetupIndex(tabs: ConfigEditingTab[], state: SetupUiState): number {
  return selectedIndexForTab(currentSetupTab(tabs, state), normalizeSetupUiState(tabs, state));
}

export function selectedSetupField(
  tabs: ConfigEditingTab[],
  state: SetupUiState,
): ConfigEditingField | undefined {
  const normalized = normalizeSetupUiState(tabs, state);
  return currentSetupTab(tabs, normalized)?.fields[selectedSetupIndex(tabs, normalized)];
}

export function setupIntentFromInput(data: string): SetupIntent | undefined {
  if (matchesKey(data, Key.escape) || data === "q") return { type: "close" };
  if (data === "d") return { type: "chooseDeployment" };
  if (data === "g") return { type: "guidedSetup" };
  if (data === "f") return { type: "flushQueue" };
  if (data === "m") return { type: "mentalModels" };
  if (matchesKey(data, Key.left) || data === "h" || data === "<") {
    return { type: "moveTab", delta: -1 };
  }
  if (matchesKey(data, Key.right) || data === "l" || data === ">") {
    return { type: "moveTab", delta: 1 };
  }
  if (matchesKey(data, Key.up) || data === "k") return { type: "moveSelection", delta: -1 };
  if (matchesKey(data, Key.down) || data === "j") return { type: "moveSelection", delta: 1 };
  if (data === "r") return { type: "resetSelectedField" };
  if (data === "a") return { type: "toggleAdvanced" };
  if (matchesKey(data, Key.enter)) return { type: "editSelectedField" };
  return undefined;
}

export function applySetupIntent(
  tabs: ConfigEditingTab[],
  state: SetupUiState,
  intent: SetupIntent,
): SetupResult {
  const normalized = normalizeSetupUiState(tabs, state);
  if (intent.type === "close") return withAction(null, normalized);
  if (intent.type === "chooseDeployment") return withAction("choose-deployment", normalized);
  if (intent.type === "guidedSetup") return withAction("guided-setup", normalized);
  if (intent.type === "flushQueue") return withAction("flush-queue", normalized);
  if (intent.type === "mentalModels") return withAction("mental-models", normalized);
  if (intent.type === "toggleAdvanced") return withAction("toggle-advanced", normalized);
  if (intent.type === "finish") return withAction("done", { ...normalized, step: "done" });
  if (intent.type === "startGuidedSetup") return withState({ ...normalized, step: "profile" });
  if (intent.type === "chooseProfile") {
    return withState({
      ...normalized,
      profileChoice: intent.profile,
      step: nextStep("profile"),
    });
  }
  if (intent.type === "chooseTemplate") {
    return withState({
      ...normalized,
      templateChoice: intent.template,
      step: nextStep("template"),
    });
  }
  if (intent.type === "back") {
    return withState({ ...normalized, step: previousStep(defaultStep(normalized.step)) });
  }

  const tab = currentSetupTab(tabs, normalized);
  if (!tab || tabs.length === 0) return withState(normalized);

  if (intent.type === "moveTab") {
    const tabIndex = (normalized.tabIndex + intent.delta + tabs.length) % tabs.length;
    const nextTab = tabs[tabIndex];
    const selectedByTab = { ...normalized.selectedByTab };
    if (nextTab)
      selectedByTab[nextTab.id] = selectedIndexForTab(nextTab, { ...normalized, tabIndex });
    return withState({ ...normalized, tabIndex, selectedByTab });
  }

  if (intent.type === "moveSelection") {
    if (tab.fields.length === 0) return withState(normalized);
    const index = selectedIndexForTab(tab, normalized);
    return withState({
      ...normalized,
      selectedByTab: {
        ...normalized.selectedByTab,
        [tab.id]: (index + intent.delta + tab.fields.length) % tab.fields.length,
      },
    });
  }

  const field = selectedSetupField(tabs, normalized);
  if (intent.type === "resetSelectedField") {
    return field?.changed ? withAction(`reset:${field.id}`, normalized) : withState(normalized);
  }
  if (intent.type === "editSelectedField") return withAction(field?.id ?? null, normalized);
  return withState(normalized);
}
