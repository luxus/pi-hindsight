import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../extensions/config.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "pi-hindsight-"));
}

describe("resolveConfig", () => {
  it("applies project config then env overrides", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        recall: { maxTokens: 123 },
        banks: { project: { derive: "cwd", mission: "Project mission" } },
      }),
    );
    const config = resolveConfig(cwd, {
      HINDSIGHT_BASE_URL: "http://h",
      PI_HINDSIGHT_PROJECT_BANK_ID: "manual-bank",
    });
    expect(config.recall.maxTokens).toBe(123);
    expect(config.hindsight.baseUrl).toBe("http://h");
    expect(config.banks.project.bankId).toBe("manual-bank");
    expect(config.banks.project.derive).toBe("manual");
    expect(config.banks.project.mission).toBe("Project mission");
  });

  it("resolves env SecretRef API keys and lets direct env override win", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { apiKey: { source: "env", name: "PROJECT_KEY" } } }),
    );

    const fromRef = resolveConfig(cwd, { PROJECT_KEY: "project-secret" });
    expect(fromRef.hindsight.apiKey).toBe("project-secret");
    expect(fromRef.hindsight.apiKeyRef).toBe("env:PROJECT_KEY");

    const override = resolveConfig(cwd, {
      PROJECT_KEY: "project-secret",
      HINDSIGHT_API_KEY: "override-secret",
    });
    expect(override.hindsight.apiKey).toBe("override-secret");

    const refFromEnv = resolveConfig(cwd, {
      HINDSIGHT_API_KEY_REF: "OTHER_KEY",
      OTHER_KEY: "other-secret",
    });
    expect(refFromEnv.hindsight.apiKey).toBe("other-secret");
    expect(refFromEnv.hindsight.apiKeyRef).toBe("env:OTHER_KEY");
  });

  it("ignores invalid project SecretRef env var names", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { apiKey: { source: "env", name: "sk-secret" } } }),
    );
    const config = resolveConfig(cwd, { "sk-secret": "secret" });
    expect(config.hindsight.apiKey).toBeUndefined();
    expect(config.hindsight.apiKeyRef).toBeUndefined();
  });

  it("ignores invalid apiKeyRef strings and prefers valid SecretRef objects", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        hindsight: {
          apiKeyRef: "env:sk-secret",
          apiKey: { source: "env", name: "PROJECT_KEY" },
        },
      }),
    );
    const config = resolveConfig(cwd, { PROJECT_KEY: "project-secret" });
    expect(config.hindsight.apiKey).toBe("project-secret");
    expect(config.hindsight.apiKeyRef).toBe("env:PROJECT_KEY");
  });

  it("keeps direct apiKey strings even if they start with env prefix", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ hindsight: { apiKey: "env:literal-secret" } }),
    );
    expect(resolveConfig(cwd).hindsight.apiKey).toBe("env:literal-secret");
  });

  it("reads boolean overrides from injected env", () => {
    const cwd = tmp();
    expect(resolveConfig(cwd, { PI_HINDSIGHT_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveConfig(cwd, { PI_HINDSIGHT_ENABLED: "true" }).enabled).toBe(true);
  });

  it("accepts recall query builder overrides", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        recall: {
          queryPreamble: "Find memory.",
          projectQueryPreamble: "Find project memory.",
          globalQueryPreamble: "Find global memory.",
          includeDateInQuery: true,
          includeRepoHintsInQuery: false,
        },
      }),
    );

    const config = resolveConfig(cwd);
    expect(config.recall.queryPreamble).toBe("Find memory.");
    expect(config.recall.projectQueryPreamble).toBe("Find project memory.");
    expect(config.recall.globalQueryPreamble).toBe("Find global memory.");
    expect(config.recall.includeDateInQuery).toBe(true);
    expect(config.recall.includeRepoHintsInQuery).toBe(false);
  });

  it("maps generic query preamble to bank-specific preambles when specific fields are absent", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({ recall: { queryPreamble: "Generic tuned lookup." } }),
    );

    const config = resolveConfig(cwd);
    expect(config.recall.projectQueryPreamble).toBe("Generic tuned lookup.");
    expect(config.recall.globalQueryPreamble).toBe("Generic tuned lookup.");
  });

  it("normalizes invalid config values back to defaults", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "hindsight.json"),
      JSON.stringify({
        recall: {
          budget: "huge",
          maxTokens: -1,
          types: ["world", 42],
          contextTurns: 0,
          roles: ["user", "alien"],
          maxQueryChars: 0,
          queryPreamble: 42,
          projectQueryPreamble: 42,
          globalQueryPreamble: 42,
          includeDateInQuery: "yes",
          includeRepoHintsInQuery: "yes",
          storeLastRecall: "yes",
          lastRecallPath: "",
          topK: -1,
          timeoutMs: 0,
          injectionPosition: "middle",
        },
        observations: { enabled: true, scopes: [["repo:{repoKey}"], []] },
        retain: {
          queuePath: "",
          appendFallback: "overwrite",
          shutdownFlushMaxJobs: -1,
          shutdownFlushTimeoutMs: 0,
          toolFilter: { toolCall: { include: [42] }, toolResult: { exclude: "read" } },
        },
        import: {
          includeBranches: "all-the-branches",
          includeCompactionSummaries: false,
          includeBranchSummaries: false,
        },
        status: { style: "sparkles", maxLength: 0 },
        notifications: { startup: "yes", recall: true, retain: true },
      }),
    );

    const config = resolveConfig(cwd);
    expect(config.recall.budget).toBe("mid");
    expect(config.recall.maxTokens).toBe(800);
    expect(config.recall.types).toEqual(["observation"]);
    expect(config.observations.enabled).toBe(true);
    expect(config.observations.scopes).toEqual([["harness:pi"], ["repo:{repoKey}"]]);
    expect(config.recall.contextTurns).toBe(2);
    expect(config.recall.roles).toEqual(["user", "assistant"]);
    expect(config.recall.maxQueryChars).toBe(800);
    expect(config.recall.queryPreamble).toBe("Pi coding task memory lookup.");
    expect(config.recall.projectQueryPreamble).toBe(
      "Project memory lookup for current repo architecture, tasks, bugs, decisions, and constraints.",
    );
    expect(config.recall.globalQueryPreamble).toBe(
      "Global memory lookup for durable user preferences, recurring workflows, coding habits, and cross-project context.",
    );
    expect(config.recall.includeDateInQuery).toBe(false);
    expect(config.recall.includeRepoHintsInQuery).toBe(true);
    expect(config.recall.storeLastRecall).toBe(false);
    expect(config.recall.lastRecallPath).toBe(".pi/hindsight/last-recall.json");
    expect(config.recall.topK).toBe(8);
    expect(config.recall.timeoutMs).toBe(10_000);
    expect(config.recall.injectionPosition).toBe("append");
    expect(config.retain.appendFallback).toBe("error");
    expect(config.retain.content.toolResult).toEqual(["error"]);
    expect(config.retain.toolFilter.toolCall.exclude).toContain("hindsight_retain");
    expect(config.retain.toolFilter.toolResult.exclude).toContain("hindsight_recall");
    expect(config.retain.toolFilter.toolResult.exclude).toContain("read");
    expect(config.retain.strip.message).toContain("usage");
    expect(config.retain.queuePath).toBe(".pi/hindsight/retain-queue.jsonl");
    expect(config.retain.shutdownFlushMaxJobs).toBe(10);
    expect(config.retain.shutdownFlushTimeoutMs).toBe(2_000);
    expect(config.import.includeBranches).toBe("current-only");
    expect(config.import.checkpointPath).toBe(".pi/hindsight/import-checkpoint.json");
    expect(config.import.resume).toBe(true);
    expect(config).not.toHaveProperty("import.includeCompactionSummaries");
    expect(config).not.toHaveProperty("import.includeBranchSummaries");
    expect(config.status.style).toBe("text");
    expect(config.status.maxLength).toBe(24);
    expect(config.notifications.startup).toBe(true);
    expect(config.notifications.recall).toBe(true);
    expect(config.notifications.retain).toBe(true);
  });
});
