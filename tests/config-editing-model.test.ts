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
    expect(fields.find((field) => field.id === "projectRetainMission")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "memoryProfile")?.editableScopes).toEqual([
      "project",
    ]);
    expect(fields.find((field) => field.id === "queuePath")?.editableScopes).toEqual(["project"]);
    expect(fields.find((field) => field.id === "importBranches")?.editableScopes).toEqual([
      "project",
    ]);
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
    expect(fields.find((field) => field.id === "globalRetainMission")?.editableScopes).toEqual([
      "project",
      "global",
    ]);
  });

  it("builds patch intent for field edits", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());
    const memoryProfile = fields.find((field) => field.id === "memoryProfile");
    const queuePath = fields.find((field) => field.id === "queuePath");

    expect(memoryProfile).toMatchObject({
      kind: "select",
      choices: ["project-only", "project+global", "global-only"],
    });
    expect(queuePath).toMatchObject({ kind: "text" });
    expect(fields.find((field) => field.id === "projectRetainMission")).toMatchObject({
      kind: "text",
      value: "built-in default",
      defaultValue: "built-in default",
    });
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
    expect(advancedBanks?.fields.map((field) => field.id)).toContain("projectRetainMission");
    expect(basicRecall?.fields.map((field) => field.id)).not.toContain("recallStoreFailures");
    expect(advancedRecall?.fields.map((field) => field.id)).toContain("recallStoreFailures");
  });

  it("shows built-in mission text in mission field details", () => {
    const fields = buildConfigEditingFields(DEFAULT_CONFIG, "bank", layers());

    expect(fields.find((field) => field.id === "projectRetainMission")?.description).toContain(
      "Built-in default: Extract durable project memory",
    );
  });

  it("shows mission summaries in status facts", () => {
    expect(
      buildStatusFacts(
        {
          ...DEFAULT_CONFIG,
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { ...DEFAULT_CONFIG.banks.project, retainMission: "Project retain mission" },
            global: {
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
        ["Project retain mission", "Project retain mission"],
        ["Global retain mission", "Global retain mission"],
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
