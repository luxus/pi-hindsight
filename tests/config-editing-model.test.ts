import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  CONFIG_FIELD_PATHS,
  CONFIG_FIELD_RESET_KEYS,
  CONFIG_RESET_PATHS,
} from "../extensions/config-field-paths.js";
import {
  buildConfigEditingFields,
  buildConfigEditingTabs,
  inputDefaultForConfigEditingField,
  parseConfigEditingFieldInput,
  patchForConfigEditingField,
  type ConfigLayers,
} from "../extensions/config-editing-model.js";
import { buildStatusFacts } from "../extensions/config-editing-registry.js";

describe("config editing model", () => {
  function layers(overrides: Partial<ConfigLayers> = {}): ConfigLayers {
    return {
      project: {},
      global: {},
      env: {},
      ...overrides,
    };
  }

  it("marks project-only settings", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());

    expect(fields.find((field) => field.id === "projectBankId")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "projectRetainMission")).toBeUndefined();
    expect(fields.find((field) => field.id === "memoryProfile")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "queuePath")?.editableScopes).toEqual(["project"]);
    expect(fields.find((field) => field.id === "importBranches")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "importToolResults")?.editableScopes).toEqual([
      "project",
    ]);
    expect(
      fields.find((field) => field.id === "importToolSummaryMaxChars")?.editableScopes,
    ).toEqual(["project"]);
    expect(fields.find((field) => field.id === "importManifest")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "importCheckpoint")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "importReplaceExisting")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "importResume")?.editableScopes).toEqual([
      "project",
    ]);
  });

  it("allows shared settings to be edited globally or per project", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());

    expect(fields.find((field) => field.id === "baseUrl")?.editableScopes).toEqual([
      "project",
      "global",
    ]);
    expect(fields.find((field) => field.id === "recallBudget")?.editableScopes).toEqual([
      "project",
      "global",
    ]);
    expect(fields.find((field) => field.id === "recallStoreFailures")?.editableScopes).toEqual([
      "project",
      "global",
    ]);
    expect(fields.find((field) => field.id === "statusStyle")?.editableScopes).toEqual([
      "project",
      "global",
    ]);
    expect(fields.find((field) => field.id === "globalRetainMission")).toBeUndefined();
  });

  it("builds registry-backed field metadata for edits", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());
    const memoryProfile = fields.find((field) => field.id === "memoryProfile");
    const queuePath = fields.find((field) => field.id === "queuePath");
    const importToolResults = fields.find((field) => field.id === "importToolResults");

    expect(memoryProfile).toMatchObject({
      kind: "select",
      choices: ["project-only", "project+global", "global-only"],
    });
    expect(queuePath).toMatchObject({ kind: "text" });
    expect(importToolResults).toMatchObject({
      kind: "select",
      choices: ["errors-only", "summary", "content"],
      value: "errors-only",
    });
    expect(fields.find((field) => field.id === "projectRetainMission")).toBeUndefined();
    expect(fields.find((field) => field.id === "apiKeyDirect")).toMatchObject({
      kind: "text",
      advanced: true,
      value: "not set",
    });
    expect(fields.find((field) => field.id === "globalRetainMode")).toMatchObject({
      kind: "select",
      advanced: true,
      value: "explicit-only",
    });
    expect(fields.find((field) => field.id === "recallStoreFailures")).toMatchObject({
      kind: "boolean",
      advanced: true,
      value: "disabled",
    });
  });

  it("builds registry-backed patch intents and input defaults", () => {
    expect(patchForConfigEditingField("enabled", "Enable", DEFAULT_CONFIG)).toEqual({
      enabled: true,
    });
    const configuredGlobal = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        user: { ...DEFAULT_CONFIG.banks.user, bankId: "global-luxus" },
      },
    };
    expect(patchForConfigEditingField("memoryProfile", "project+global", configuredGlobal)).toEqual(
      {
        memoryProfile: "project+global",
        globalBankId: "global-luxus",
      },
    );
    expect(patchForConfigEditingField("recallMaxTokens", "1234", DEFAULT_CONFIG)).toEqual({
      recallMaxTokens: 1234,
    });
    expect(patchForConfigEditingField("importToolResults", "summary", DEFAULT_CONFIG)).toEqual({
      importToolResults: "summary",
    });
    expect(patchForConfigEditingField("importToolSummaryMaxChars", "250", DEFAULT_CONFIG)).toEqual({
      importToolResultSummaryMaxChars: 250,
    });
    expect(inputDefaultForConfigEditingField("apiKeyEnv", DEFAULT_CONFIG, "bank")).toBe(
      "HINDSIGHT_API_KEY",
    );
    expect(inputDefaultForConfigEditingField("projectBankId", DEFAULT_CONFIG, "bank")).toBe("bank");
    expect(parseConfigEditingFieldInput({ id: "recallMaxTokens", kind: "positive-int" }, "5")).toBe(
      "5",
    );
    expect(() =>
      parseConfigEditingFieldInput({ id: "recallMaxTokens", kind: "positive-int" }, "0"),
    ).toThrow("recallMaxTokens must be a positive integer");
    expect(
      inputDefaultForConfigEditingField("importToolSummaryMaxChars", DEFAULT_CONFIG, "bank"),
    ).toBe("500");
  });

  it("hides advanced fields unless advanced mode is enabled", () => {
    const basicBanks = buildConfigEditingTabs(DEFAULT_CONFIG, "bank", layers()).find(
      (tab) => tab.id === "Banks",
    );
    const advancedBanks = buildConfigEditingTabs(DEFAULT_CONFIG, "bank", layers(), [], {
      showAdvanced: true,
    }).find((tab) => tab.id === "Banks");
    const basicRecall = buildConfigEditingTabs(DEFAULT_CONFIG, "bank", layers()).find(
      (tab) => tab.id === "Recall",
    );
    const advancedRecall = buildConfigEditingTabs(DEFAULT_CONFIG, "bank", layers(), [], {
      showAdvanced: true,
    }).find((tab) => tab.id === "Recall");

    expect(basicBanks?.fields.map((field) => field.id)).not.toContain("projectRetainMission");
    expect(advancedBanks?.fields.map((field) => field.id)).not.toContain("projectRetainMission");
    expect(basicRecall?.fields.map((field) => field.id)).not.toContain("recallStoreFailures");
    expect(advancedRecall?.fields.map((field) => field.id)).toContain("recallStoreFailures");
  });

  it("hides local mission editors because missions are Hindsight bank config", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());

    expect(fields.map((field) => field.id)).not.toEqual(
      expect.arrayContaining([
        "projectRetainMission",
        "projectReflectMission",
        "projectObservationsMission",
        "globalRetainMission",
        "globalReflectMission",
        "globalObservationsMission",
      ]),
    );
  });

  it("shows legacy local mission overrides as status warnings", () => {
    expect(
      buildStatusFacts(
        {
          ...DEFAULT_CONFIG,
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { ...DEFAULT_CONFIG.banks.project, retainMission: "Project retain mission" },
            user: {
              enabled: true,
              bankId: "global-luxus",
              retainMission: "Global retain mission",
            },
          },
        },
        "project-bank",
      ),
    ).toEqual(
      expect.arrayContaining([
        ["Project mission overrides", "legacy local config; prefer Hindsight bank config"],
        ["User mission overrides", "legacy local config; prefer Hindsight bank config"],
      ]),
    );
  });

  it("keeps every field backed by path and reset metadata", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());

    for (const field of fields) {
      expect(CONFIG_FIELD_PATHS).toHaveProperty(field.id);
      expect(CONFIG_FIELD_RESET_KEYS).toHaveProperty(field.id);
      expect(CONFIG_FIELD_RESET_KEYS[field.id]).toBe(field.resetKey);
      expect(CONFIG_RESET_PATHS).toHaveProperty(field.resetKey);
    }
  });

  it("reports source precedence and layer values", () => {
    const fields = buildConfigEditingFields(
      { ...DEFAULT_CONFIG, hindsight: { ...DEFAULT_CONFIG.hindsight, baseUrl: "http://env" } },
      "bank",
      layers({
        project: { hindsight: { baseUrl: "http://project" } },
        global: { hindsight: { baseUrl: "http://global" } },
        env: { HINDSIGHT_BASE_URL: "http://env" },
      }),
    );

    const baseUrl = fields.find((field) => field.id === "baseUrl");
    expect(baseUrl).toMatchObject({
      value: "http://env",
      source: "env",
      envValue: "http://env",
      projectValue: "http://project",
      globalValue: "http://global",
    });
  });
});
