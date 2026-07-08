import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProjectBankMissions } from "../extensions/banks/bank-operations.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { createMemoryOperations } from "../extensions/operations/memory-operation-service.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("memory operations", () => {
  it("configures memory profiles without implicit project/global overrides", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await operations.configure(cwd, { memoryProfile: "global-only", globalBankId: "shared" });
    let written = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as Record<
      string,
      any
    >;
    expect(written.banks).toMatchObject({
      project: { enabled: false },
      user: { enabled: true, bankId: "shared" },
    });

    await operations.configure(cwd, { timeoutMs: 1234 });
    written = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as Record<
      string,
      any
    >;
    expect(written.banks).toMatchObject({
      project: { enabled: false },
      user: { enabled: true, bankId: "shared" },
    });
    expect(written.hindsight).toMatchObject({ timeoutMs: 1234 });

    await operations.configure(cwd, { memoryProfile: "project-only", globalBankId: "shared" });
    written = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as Record<
      string,
      any
    >;
    expect(written.banks).toMatchObject({
      project: { enabled: true },
      user: { enabled: false },
    });
  });

  it("configures global scope without writing project config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-project-"));
    const home = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-home-"));
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const operations = createMemoryOperations({
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "project-bank",
      });

      await operations.configure(cwd, { scope: "global", baseUrl: "http://global" });

      const written = JSON.parse(
        readFileSync(join(home, ".pi", "agent", "hindsight.json"), "utf8"),
      ) as Record<string, any>;
      expect(written.hindsight.baseUrl).toBe("http://global");
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("passes explicit retain options, query timestamps, explicit entities, and reflect response schemas", async () => {
    const calls: Array<{ method: string; bank?: string; options?: unknown }> = [];
    const operations = createMemoryOperations({
      getClient: () => ({
        retain: async (bank, _content, options) => {
          calls.push({ method: "retain", bank, options });
        },
        recall: async (bank, _query, options) => {
          calls.push({ method: "recall", bank, options });
          return [];
        },
        reflect: async (bank, _query, options) => {
          calls.push({ method: "reflect", bank, options });
          return {};
        },
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, queryTimestamp: "2024-01-01T00:00:00Z" },
        retain: { ...DEFAULT_CONFIG.retain, async: false },
      }),
      getProjectBankId: () => "project-bank",
    });
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));

    await operations.recall(cwd, "query", undefined, undefined, {
      queryTimestamp: "2024-02-01T00:00:00Z",
      types: ["observation"],
      trace: true,
      includeEntities: false,
      maxEntityTokens: 128,
      includeChunks: true,
      maxChunkTokens: 512,
      includeSourceFacts: true,
      maxSourceFactsTokens: 1024,
    });
    await operations.retainExplicit({
      cwd,
      content: "content",
      context: "context",
      documentId: "explicit-doc",
      timestamp: "2024-03-01T00:00:00Z",
      metadata: {
        cwd: "wrong-cwd",
        pi_session_file: "wrong-session",
        source: "wrong-source",
        retainSource: "wrong-retain-source",
        source_id: "source-1",
      },
      updateMode: "append",
      observationScopes: [["repo:manual"]],
      async: true,
      entities: [{ text: "Alice", type: "person" }],
    });
    await operations.reflect(
      cwd,
      "query",
      undefined,
      undefined,
      {
        type: "object",
        properties: { answer: { type: "string" } },
      },
      {
        factTypes: ["observation"],
        excludeMentalModels: true,
        excludeMentalModelIds: ["model:stale"],
        includeToolCalls: true,
        includeToolCallOutput: false,
        tags: ["topic:hindsight"],
        tagsMatch: "all_strict",
        tagGroups: [{ tags: ["kind:decision"], match: "any_strict" }],
      },
    );

    expect(calls.find((call) => call.method === "recall")?.options).toMatchObject({
      queryTimestamp: "2024-02-01T00:00:00Z",
      types: ["observation"],
      trace: true,
      includeEntities: false,
      maxEntityTokens: 128,
      includeChunks: true,
      maxChunkTokens: 512,
      includeSourceFacts: true,
      maxSourceFactsTokens: 1024,
    });
    expect(calls.find((call) => call.method === "retain")?.options).toMatchObject({
      documentId: "explicit-doc",
      timestamp: "2024-03-01T00:00:00Z",
      metadata: { cwd, source: "pi-hindsight", retainSource: "tool", source_id: "source-1" },
      updateMode: "append",
      observationScopes: [["repo:manual"]],
      async: true,
      entities: [{ text: "Alice", type: "person" }],
    });
    const retainOptions = calls.find((call) => call.method === "retain")?.options as {
      metadata?: Record<string, string>;
    };
    expect(retainOptions.metadata).not.toHaveProperty("pi_session_file");
    expect(calls.find((call) => call.method === "reflect")?.options).toMatchObject({
      responseSchema: { type: "object", properties: { answer: { type: "string" } } },
      factTypes: ["observation"],
      excludeMentalModels: true,
      excludeMentalModelIds: ["model:stale"],
      includeToolCalls: true,
      includeToolCallOutput: false,
      tagGroups: [
        { tags: [expect.stringMatching(/^repo:/)], match: "any_strict" },
        { tags: ["topic:hindsight"], match: "all_strict" },
        { tags: ["kind:decision"], match: "any_strict" },
      ],
    });
  });

  it("records explicit retain receipts for exact deletion", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => ({ ...DEFAULT_CONFIG, retain: { ...DEFAULT_CONFIG.retain, async: false } }),
      getProjectBankId: () => "project-bank",
    });

    const retained = await operations.retainExplicit({
      cwd,
      content: "remember exact fact",
      context: "user asked to keep exact fact",
      tags: ["preference"],
    });
    const receipts = await operations.listRetainReceipts(cwd);

    expect(receipts).toEqual([
      expect.objectContaining({
        bankId: "project-bank",
        documentId: retained.documentId,
        queueJobId: retained.queueJobId,
        updateMode: "replace",
        source: "tool",
        context: "user asked to keep exact fact",
        tags: expect.arrayContaining(["preference", "source:pi"]),
      }),
    ]);
  });

  it("resolves project/global bank aliases for explicit operations", async () => {
    const calls: Array<{ method: string; bank: string }> = [];
    const config = {
      ...DEFAULT_CONFIG,
      banks: { ...DEFAULT_CONFIG.banks, user: { enabled: true, bankId: "global-luxus" } },
      retain: { ...DEFAULT_CONFIG.retain, async: false },
    };
    const operations = createMemoryOperations({
      getClient: () => ({
        retain: async (bank) => {
          calls.push({ method: "retain", bank });
        },
        recall: async (bank) => {
          calls.push({ method: "recall", bank });
          return [];
        },
        reflect: async (bank) => {
          calls.push({ method: "reflect", bank });
          return {};
        },
      }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));

    await operations.recall(cwd, "query", "global");
    await operations.retainExplicit({
      cwd,
      content: "content",
      context: "context",
      bank: "global",
    });
    await operations.reflect(cwd, "query", undefined, "project");

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "recall", bank: "global-luxus" },
        { method: "retain", bank: "global-luxus" },
        { method: "reflect", bank: "project-bank" },
      ]),
    );
  });

  it("assembles a doctor report from live health, queue, and import state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), health: async () => ({}) }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const report = JSON.parse(await operations.doctor(cwd, "/tmp/session.jsonl")) as Record<
      string,
      unknown
    >;

    expect(report.health).toBe("reachable");
    expect(report.projectBankId).toBe("project-bank");
    expect(report.sessionFile).toBe("/tmp/session.jsonl");
    expect(report.queueLength).toBe(0);
    const imports = report.imports as { count: number };
    expect(imports.count).toBe(0);
  });

  it("reports doctor health as unreachable when the client health check fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));
    const operations = createMemoryOperations({
      getClient: () => ({
        ...client(),
        health: async () => {
          throw new Error("connection refused");
        },
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const report = JSON.parse(await operations.doctor(cwd)) as Record<string, unknown>;

    expect(report.health).toBe("unreachable: connection refused");
  });

  it("lists the bundled bank templates", () => {
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const templates = operations.listBankTemplates();

    expect(templates.map((template) => template.id)).toEqual(
      expect.arrayContaining([
        "pi-coding-project",
        "pi-conversation-project",
        "pi-coding-user",
        "pi-conversation-user",
      ]),
    );
  });

  it("applies a project-targeted bank template to the resolved project bank", async () => {
    const importBankTemplate = vi.fn(async () => ({
      bank_id: "project-bank",
      config_applied: true,
    }));
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), importBankTemplate }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const result = await operations.applyBankTemplate({
      templateId: "pi-coding-project",
      dryRun: true,
    });

    expect(result.bankId).toBe("project-bank");
    expect(importBankTemplate).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({ version: "1" }),
      { dryRun: true },
    );
  });

  it("applies a user-targeted bank template to the configured user bank", async () => {
    const importBankTemplate = vi.fn(async () => ({
      bank_id: "global-luxus",
      config_applied: true,
    }));
    const config = {
      ...DEFAULT_CONFIG,
      banks: { ...DEFAULT_CONFIG.banks, user: { enabled: true, bankId: "global-luxus" } },
    };
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), importBankTemplate }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    const result = await operations.applyBankTemplate({ templateId: "pi-user-preferences" });

    expect(result.bankId).toBe("global-luxus");
    expect(result.dryRun).toBe(true);
    expect(importBankTemplate).toHaveBeenCalledWith(
      "global-luxus",
      expect.objectContaining({ version: "1" }),
      { dryRun: true },
    );
  });

  it("keeps a customized project mission instead of overwriting it with the template default", async () => {
    const importBankTemplate = vi.fn(async () => ({
      bank_id: "project-bank",
      config_applied: true,
    }));
    const config = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        project: { ...DEFAULT_CONFIG.banks.project, retainMission: "Custom retain mission" },
      },
    };
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), importBankTemplate }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await operations.applyBankTemplate({ templateId: "pi-coding-project" });

    const manifest = (importBankTemplate.mock.calls as unknown[][])[0]?.[1] as {
      bank?: { retain_mission?: string; reflect_mission?: string };
    };
    expect(manifest.bank?.retain_mission).toBe("Custom retain mission");
    expect(manifest.bank?.reflect_mission).toBe(defaultProjectBankMissions().reflectMission);
  });

  it("keeps a customized user mission instead of overwriting it with the template default", async () => {
    const importBankTemplate = vi.fn(async () => ({
      bank_id: "global-luxus",
      config_applied: true,
    }));
    const config = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        user: { enabled: true, bankId: "global-luxus", reflectMission: "Custom reflect mission" },
      },
    };
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), importBankTemplate }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });

    await operations.applyBankTemplate({ templateId: "pi-user-preferences" });

    const manifest = (importBankTemplate.mock.calls as unknown[][])[0]?.[1] as {
      bank?: { reflect_mission?: string };
    };
    expect(manifest.bank?.reflect_mission).toBe("Custom reflect mission");
  });

  it("rejects applying a user-targeted template when the user bank is disabled", async () => {
    const importBankTemplate = vi.fn(async () => ({}));
    const operations = createMemoryOperations({
      getClient: () => ({ ...client(), importBankTemplate }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await expect(
      operations.applyBankTemplate({ templateId: "pi-user-preferences" }),
    ).rejects.toThrow("User Hindsight bank is disabled");
    expect(importBankTemplate).not.toHaveBeenCalled();
  });

  it("rejects an unknown bank template id", async () => {
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await expect(operations.applyBankTemplate({ templateId: "does-not-exist" })).rejects.toThrow(
      "Unknown bank template id",
    );
  });

  it("rejects applying a bank template when the client does not support import", async () => {
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await expect(operations.applyBankTemplate({ templateId: "pi-coding-project" })).rejects.toThrow(
      "does not support bank template import",
    );
  });
});
