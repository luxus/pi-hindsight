import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectConfigDeletes,
  buildProjectConfigPatch,
  deepMergeConfig,
  globalConfigPath,
  projectConfigPath,
  readGlobalConfig,
  readProjectConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from "../extensions/config/config-writer.js";

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
        user: {
          retainMission: "Global retain",
          reflectMission: "Global reflect",
          observationsMission: "Global observations",
        },
      },
    });
  });

  it("builds memory profile patches", () => {
    expect(buildProjectConfigPatch({ memoryProfile: "project-only" })).toEqual({
      banks: { project: { enabled: true }, user: { enabled: false } },
      userRetain: { mode: "explicit-only" },
      recall: { enabled: true },
      retain: { enabled: true },
    });
    expect(buildProjectConfigPatch({ memoryProfile: "project+global" })).toEqual({
      banks: { project: { enabled: true }, user: { enabled: true } },
      userRetain: { mode: "explicit-only" },
      recall: { enabled: true },
      retain: { enabled: true },
    });
    expect(
      buildProjectConfigPatch({
        memoryProfile: "global-only",
        projectBankId: "project",
        globalBankId: "shared",
      }),
    ).toEqual({
      banks: { project: { enabled: false }, user: { enabled: true, bankId: "shared" } },
      userRetain: { mode: "explicit-only" },
      recall: { enabled: true },
      retain: { enabled: true },
    });
    expect(buildProjectConfigPatch({ memoryProfile: "recall-only" })).toEqual({
      recall: { enabled: true },
      retain: { enabled: false },
    });
  });

  it("builds extended setup patches", () => {
    expect(
      buildProjectConfigPatch({
        timeoutMs: 1234,
        apiKeyEnvVar: "HINDSIGHT_API_KEY",
        recallBudget: "mid",
        recallMaxTokens: 900,
        recallUserMaxTokens: 300,
        recallStoreLast: true,
        recallStoreFailures: true,
        recallPreferObservations: false,
        retainAsync: false,
        importMode: "raw",
        importQualityProfile: "strict",
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
      recall: {
        budget: "mid",
        maxTokens: 900,
        userMaxTokens: 300,
        storeLastRecall: true,
        storeLastRecallFailures: true,
        preferObservations: false,
      },
      retain: { async: false },
      import: {
        mode: "raw",
        qualityProfile: "strict",
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

  it("builds user retain mode patch", () => {
    expect(buildProjectConfigPatch({ globalRetainMode: "explicit-only" })).toEqual({
      userRetain: { mode: "explicit-only" },
    });
  });

  it("resets profile-controlled recall, retain, and user retain overrides", () => {
    expect(buildProjectConfigDeletes({ resetDefaults: ["banks.profile"] })).toEqual([
      ["banks", "project", "enabled"],
      ["banks", "user", "enabled"],
      ["banks", "global", "enabled"],
      ["userRetain", "mode"],
      ["globalRetain", "mode"],
      ["recall", "enabled"],
      ["retain", "enabled"],
    ]);
  });

  it("can write direct API keys only for user config while keeping env refs preferred", () => {
    expect(buildProjectConfigPatch({ directApiKey: "raw-secret", scope: "global" })).toEqual({
      hindsight: { apiKey: "raw-secret" },
    });
    expect(() => buildProjectConfigPatch({ directApiKey: "raw-secret" })).toThrow(/user config/);
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

  it("edits active project JSONC config instead of creating a shadowing JSON file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-project-jsonc-"));
    const jsoncPath = join(cwd, ".pi", "hindsight.jsonc");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      jsoncPath,
      `{
  // keep this comment
  "hindsight": { "baseUrl": "http://old" },
  "recall": { "budget": "low" }
}\n`,
      "utf8",
    );

    const result = await writeProjectConfig(
      cwd,
      buildProjectConfigPatch({ baseUrl: "http://new" }),
    );

    expect(result.path).toBe(jsoncPath);
    expect(existsSync(projectConfigPath(cwd))).toBe(false);
    const text = readFileSync(jsoncPath, "utf8");
    expect(text).toContain("// keep this comment");
    expect(readProjectConfig(cwd)).toMatchObject({
      hindsight: { baseUrl: "http://new" },
      recall: { budget: "low" },
    });
  });

  it("edits active global JSONC config and preserves existing values", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-hindsight-global-jsonc-"));
    const jsoncPath = join(home, ".pi", "agent", "hindsight.jsonc");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      jsoncPath,
      `{
  // global comment
  "hindsight": { "timeoutMs": 1000 },
  "recall": { "budget": "high" }
}\n`,
      "utf8",
    );

    const result = await writeGlobalConfig(
      buildProjectConfigPatch({ baseUrl: "http://global" }),
      [],
      home,
    );

    expect(result.path).toBe(jsoncPath);
    expect(existsSync(globalConfigPath(home))).toBe(false);
    const text = readFileSync(jsoncPath, "utf8");
    expect(text).toContain("// global comment");
    expect(readGlobalConfig(home)).toMatchObject({
      hindsight: { baseUrl: "http://global", timeoutMs: 1000 },
      recall: { budget: "high" },
    });
  });

  it("replaces scalar JSONC values with object patches without creating shadow config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-jsonc-scalar-object-"));
    const jsoncPath = join(cwd, ".pi", "hindsight.jsonc");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      jsoncPath,
      `{
  // keep scalar-to-object comment
  "hindsight": { "apiKey": "old-secret", "baseUrl": "http://old" }
}\n`,
      "utf8",
    );

    const result = await writeProjectConfig(
      cwd,
      buildProjectConfigPatch({ apiKeyEnvVar: "HINDSIGHT_API_KEY" }),
    );

    expect(result.path).toBe(jsoncPath);
    expect(existsSync(projectConfigPath(cwd))).toBe(false);
    const text = readFileSync(jsoncPath, "utf8");
    expect(text).toContain("// keep scalar-to-object comment");
    expect(readProjectConfig(cwd)).toMatchObject({
      hindsight: {
        apiKey: { source: "env", name: "HINDSIGHT_API_KEY" },
        baseUrl: "http://old",
      },
    });
  });

  it("replaces scalar global JSONC values with object patches", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-hindsight-global-jsonc-scalar-object-"));
    const jsoncPath = join(home, ".pi", "agent", "hindsight.jsonc");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(jsoncPath, `{ "hindsight": { "apiKey": "old-secret" } }\n`, "utf8");

    const result = await writeGlobalConfig(
      buildProjectConfigPatch({ apiKeyEnvVar: "HINDSIGHT_API_KEY" }),
      [],
      home,
    );

    expect(result.path).toBe(jsoncPath);
    expect(existsSync(globalConfigPath(home))).toBe(false);
    expect(readGlobalConfig(home)).toMatchObject({
      hindsight: { apiKey: { source: "env", name: "HINDSIGHT_API_KEY" } },
    });
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
