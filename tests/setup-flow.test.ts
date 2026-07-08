import { describe, expect, it } from "vitest";
import type {
  ConfigEditingField,
  ConfigEditingTab,
} from "../extensions/config/config-editing-model.js";
import {
  applySetupIntent,
  selectedSetupField,
  selectedSetupIndex,
  setupIntentFromInput,
} from "../extensions/tui/setup-tui.js";
import type { SetupUiState } from "../extensions/tui/setup-tui.js";

function field(id: ConfigEditingField["id"], changed = false): ConfigEditingField {
  return {
    id,
    tab: "Connection",
    label: id,
    description: `${id} description`,
    value: "value",
    defaultValue: "default",
    source: changed ? "project" : "default",
    editableScopes: ["project"],
    changed,
    resetKey: id === "timeoutMs" ? "hindsight.timeoutMs" : "hindsight.baseUrl",
    kind: id === "timeoutMs" ? "positive-int" : "text",
  };
}

function tabs(): ConfigEditingTab[] {
  return [
    { id: "Status", fields: [] },
    { id: "Connection", fields: [field("baseUrl", true), field("timeoutMs")] },
    { id: "Banks", fields: [field("projectBankId")] },
  ];
}

describe("setup flow state", () => {
  it("maps setup keystrokes to hub and settings intents", () => {
    expect(setupIntentFromInput("q")).toEqual({ type: "close" });
    expect(setupIntentFromInput("d")).toEqual({ type: "chooseDeployment" });
    expect(setupIntentFromInput("g")).toEqual({ type: "guidedSetup" });
    expect(setupIntentFromInput("f")).toEqual({ type: "flushQueue" });
    expect(setupIntentFromInput("m")).toEqual({ type: "setMode" });
    expect(setupIntentFromInput("x")).toEqual({ type: "nextOptOut" });
    expect(setupIntentFromInput("t")).toEqual({ type: "applyMentalModels" });
    expect(setupIntentFromInput("i")).toEqual({ type: "importSessions" });
    expect(setupIntentFromInput("o")).toEqual({ type: "runDoctor" });
    expect(setupIntentFromInput("n")).toEqual({ type: "initConfig" });
    expect(setupIntentFromInput("h")).toEqual({ type: "moveTab", delta: -1 });
    expect(setupIntentFromInput("l")).toEqual({ type: "moveTab", delta: 1 });
    expect(setupIntentFromInput("j")).toEqual({ type: "moveSelection", delta: 1 });
    expect(setupIntentFromInput("k")).toEqual({ type: "moveSelection", delta: -1 });
    expect(setupIntentFromInput("a")).toEqual({ type: "toggleAdvanced" });
    expect(setupIntentFromInput("r")).toEqual({ type: "resetSelectedField" });
    expect(setupIntentFromInput("z")).toBeUndefined();
  });

  it("moves tabs and field selection without rendering knowledge", () => {
    const state: SetupUiState = { tabIndex: 1, selectedByTab: { Connection: 0 } };

    const movedField = applySetupIntent(tabs(), state, { type: "moveSelection", delta: 1 });
    expect(movedField.kind).toBe("state");
    expect(selectedSetupIndex(tabs(), movedField.state)).toBe(1);
    expect(selectedSetupField(tabs(), movedField.state)?.id).toBe("timeoutMs");

    const movedTab = applySetupIntent(tabs(), movedField.state, { type: "moveTab", delta: 1 });
    expect(movedTab.kind).toBe("state");
    expect(movedTab.state.tabIndex).toBe(2);
    expect(selectedSetupField(tabs(), movedTab.state)?.id).toBe("projectBankId");
  });

  it("returns explicit actions for hub, edit, reset, and close", () => {
    const state: SetupUiState = { tabIndex: 1, selectedByTab: { Connection: 0 } };

    expect(applySetupIntent(tabs(), state, { type: "editSelectedField" })).toMatchObject({
      kind: "action",
      action: "baseUrl",
    });
    expect(applySetupIntent(tabs(), state, { type: "resetSelectedField" })).toMatchObject({
      kind: "action",
      action: "reset:baseUrl",
    });
    expect(applySetupIntent(tabs(), state, { type: "chooseDeployment" })).toMatchObject({
      kind: "action",
      action: "choose-deployment",
    });
    expect(applySetupIntent(tabs(), state, { type: "setMode" })).toMatchObject({
      kind: "action",
      action: "set-mode",
    });
    expect(applySetupIntent(tabs(), state, { type: "nextOptOut" })).toMatchObject({
      kind: "action",
      action: "next-opt-out",
    });
    expect(applySetupIntent(tabs(), state, { type: "applyMentalModels" })).toMatchObject({
      kind: "action",
      action: "apply-mental-models",
    });
    expect(applySetupIntent(tabs(), state, { type: "importSessions" })).toMatchObject({
      kind: "action",
      action: "import-sessions",
    });
    expect(applySetupIntent(tabs(), state, { type: "runDoctor" })).toMatchObject({
      kind: "action",
      action: "run-doctor",
    });
    expect(applySetupIntent(tabs(), state, { type: "close" })).toMatchObject({
      kind: "action",
      action: null,
    });
  });
});
