import { describe, expect, it } from "vitest";
import type { ConfigEditingField, ConfigEditingTab } from "../extensions/config-editing-model.js";
import {
  applySetupIntent,
  selectedSetupField,
  selectedSetupIndex,
  setupIntentFromInput,
} from "../extensions/setup-tui.js";
import type { SetupUiState } from "../extensions/setup-tui.js";

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
  it("maps setup keystrokes to behavior-neutral intents", () => {
    expect(setupIntentFromInput("q")).toEqual({ type: "close" });
    expect(setupIntentFromInput("d")).toEqual({ type: "chooseDeployment" });
    expect(setupIntentFromInput("g")).toEqual({ type: "guidedSetup" });
    expect(setupIntentFromInput("f")).toEqual({ type: "flushQueue" });
    expect(setupIntentFromInput("m")).toEqual({ type: "mentalModels" });
    expect(setupIntentFromInput("h")).toEqual({ type: "moveTab", delta: -1 });
    expect(setupIntentFromInput("l")).toEqual({ type: "moveTab", delta: 1 });
    expect(setupIntentFromInput("j")).toEqual({ type: "moveSelection", delta: 1 });
    expect(setupIntentFromInput("k")).toEqual({ type: "moveSelection", delta: -1 });
    expect(setupIntentFromInput("a")).toEqual({ type: "toggleAdvanced" });
    expect(setupIntentFromInput("r")).toEqual({ type: "resetSelectedField" });
    expect(setupIntentFromInput("x")).toBeUndefined();
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

  it("returns explicit actions for edit, reset, deployment, and close", () => {
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
    expect(applySetupIntent(tabs(), state, { type: "flushQueue" })).toMatchObject({
      kind: "action",
      action: "flush-queue",
    });
    expect(applySetupIntent(tabs(), state, { type: "mentalModels" })).toMatchObject({
      kind: "action",
      action: "mental-models",
    });
    expect(applySetupIntent(tabs(), state, { type: "close" })).toMatchObject({
      kind: "action",
      action: null,
    });

    const unchangedState: SetupUiState = { tabIndex: 1, selectedByTab: { Connection: 1 } };
    expect(applySetupIntent(tabs(), unchangedState, { type: "resetSelectedField" })).toMatchObject({
      kind: "state",
    });
  });

  it("records guided setup profile and template choices for future onboarding", () => {
    const initial: SetupUiState = { tabIndex: 0, selectedByTab: {} };

    const started = applySetupIntent(tabs(), initial, { type: "startGuidedSetup" });
    expect(started.state.step).toBe("profile");

    const profiled = applySetupIntent(tabs(), started.state, {
      type: "chooseProfile",
      profile: "project-global",
    });
    expect(profiled.state).toMatchObject({ step: "banks", profileChoice: "project-global" });

    const templated = applySetupIntent(
      tabs(),
      { ...profiled.state, step: "template" },
      {
        type: "chooseTemplate",
        template: "paste-json",
      },
    );
    expect(templated.state).toMatchObject({ step: "review", templateChoice: "paste-json" });

    const backedUp = applySetupIntent(tabs(), templated.state, { type: "back" });
    expect(backedUp.state.step).toBe("template");

    expect(applySetupIntent(tabs(), templated.state, { type: "finish" })).toMatchObject({
      kind: "action",
      action: "done",
      state: { step: "done" },
    });
  });
});
