import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectConfigDeletes,
  buildProjectConfigPatch,
  deepMergeConfig,
  globalConfigPath,
  projectConfigPath,
  readGlobalConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from "../extensions/config-writer.js";

describe("config writer", () => {
  it("builds project bank override patch", () => {
    expect(buildProjectConfigPatch({ projectBankId: "bank", baseUrl: "http://h" })).toEqual({
      hindsight: { baseUrl: "http://h" },
      banks: { project: { enabled: true, derive: "manual", bankId: "bank" } },
    });
  });

  it("builds granular mission override patches", () => {
    expect(
      buildProjectConfigPatch({
        projectRetainMission: "Project retain",
        projectReflectMission: "Project reflect",
        projectObservationsMission: "Project observations",
        globalRetainMission: "Global retain",
        globalReflectMission: "Global reflect",
        globalObservationsMission: "Global observations",
      }),
    ).toEqual({
      banks: {
        project: {
          retainMission: "Project retain",
          reflectMission: "Project reflect",
          observationsMission: "Project observations",
        },
        global: {
          retainMission: "Global retain",
          reflectMission: "Global reflect",
          observationsMission: "Global observations",
        },
      },
    });
  });

  it("builds memory profile patches", () => {
    expect(buildProjectConfigPatch({ memoryProfile: "project-only" })).toEqual({
      banks: { project: { enabled: true }, global: { enabled: false } },
    });
    expect(buildProjectConfigPatch({ memoryProfile: "project+global" })).toEqual({
      banks: { project: { enabled: true }, global: { enabled: true, bankId: "pi-global" } },
    });
    expect(
      buildProjectConfigPatch({
        memoryProfile: "global-only",
        projectBankId: "project",
        globalBankId: "shared",
      }),
    ).toEqual({
      banks: { project: { enabled: false }, global: { enabled: true, bankId: "shared" } },
    });
  });

  it("builds extended setup patches", () => {
    expect(
      buildProjectConfigPatch({
        timeoutMs: 1234,
        apiKeyEnvVar: "HINDSIGHT_API_KEY",
        recallBudget: "mid",
        recallMaxTokens: 900,
        retainAsync: false,
        importIncludeBranches: "all-leaves",
        importManifestPath: ".pi/custom-manifest.json",
        importCheckpointPath: ".pi/custom-checkpoint.json",
        importReplaceExistingDocs: false,
        importResume: false,
        statusStyle: "emoji",
        statusDetail: "activity",
        statusMaxLength: 30,
        statusShowActivity: false,
        notifyRecall: true,
        notifyRetain: true,
      }),
    ).toEqual({
      hindsight: { timeoutMs: 1234, apiKey: { source: "env", name: "HINDSIGHT_API_KEY" } },
      recall: { budget: "mid", maxTokens: 900 },
      retain: { async: false },
      import: {
        includeBranches: "all-leaves",
        manifestPath: ".pi/custom-manifest.json",
        checkpointPath: ".pi/custom-checkpoint.json",
        replaceExistingImportedDocs: false,
        resume: false,
      },
      status: { style: "emoji", detail: "activity", maxLength: 30, showActivity: false },
      notifications: { recall: true, retain: true },
    });
  });

  it("builds global retain mode patch", () => {
    expect(buildProjectConfigPatch({ globalRetainMode: "router" })).toEqual({
      globalRetain: { mode: "router" },
    });
  });

  it("can write direct API keys while keeping env refs preferred", () => {
    expect(buildProjectConfigPatch({ directApiKey: "raw-secret" })).toEqual({
      hindsight: { apiKey: "raw-secret" },
    });
  });

  it("rejects invalid api key env var names", () => {
    expect(() => buildProjectConfigPatch({ apiKeyEnvVar: "sk-secret" })).toThrow(
      /environment variable name/,
    );
  });

  it("deep merges without deleting existing config", () => {
    expect(
      deepMergeConfig(
        { recall: { maxTokens: 100 }, banks: { global: { enabled: false } } },
        { banks: { project: { bankId: "b" } } },
      ),
    ).toEqual({
      recall: { maxTokens: 100 },
      banks: { global: { enabled: false }, project: { bankId: "b" } },
    });
  });

  it("writes .pi/hindsight.json", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-config-"));
    const result = await writeProjectConfig(
      cwd,
      buildProjectConfigPatch({ projectBankId: "bank" }),
    );
    expect(result.path).toBe(projectConfigPath(cwd));
    const written = JSON.parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
    expect(written).toMatchObject({ banks: { project: { bankId: "bank", derive: "manual" } } });
  });

  it("writes global config without touching project config", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-hindsight-global-home-"));
    const result = await writeGlobalConfig(
      buildProjectConfigPatch({ baseUrl: "http://global" }),
      [],
      home,
    );
    expect(result.path).toBe(globalConfigPath(home));
    expect(readGlobalConfig(home)).toMatchObject({ hindsight: { baseUrl: "http://global" } });
  });

  it("deletes global config values when resetting global overrides", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-hindsight-global-reset-"));
    await writeGlobalConfig(buildProjectConfigPatch({ recallBudget: "high" }), [], home);
    await writeGlobalConfig(
      buildProjectConfigPatch({ resetDefaults: ["recall.budget"] }),
      buildProjectConfigDeletes({ resetDefaults: ["recall.budget"] }),
      home,
    );
    const written = readGlobalConfig(home) as Record<string, any>;
    expect(written.recall).not.toHaveProperty("budget");
  });

  it("deletes project config values when resetting defaults", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-config-reset-"));
    await writeProjectConfig(
      cwd,
      buildProjectConfigPatch({ projectBankId: "bank", recallBudget: "high" }),
    );
    await writeProjectConfig(
      cwd,
      buildProjectConfigPatch({ resetDefaults: ["banks.project.bankId", "recall.budget"] }),
      buildProjectConfigDeletes({ resetDefaults: ["banks.project.bankId", "recall.budget"] }),
    );
    const written = JSON.parse(readFileSync(projectConfigPath(cwd), "utf8")) as Record<string, any>;
    expect(written.banks.project).not.toHaveProperty("bankId");
    expect(written.banks.project).not.toHaveProperty("derive");
    expect(written.recall).not.toHaveProperty("budget");
  });
});
