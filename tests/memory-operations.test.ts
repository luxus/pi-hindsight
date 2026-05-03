import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
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
      global: { enabled: true, bankId: "shared" },
    });

    await operations.configure(cwd, { timeoutMs: 1234 });
    written = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as Record<
      string,
      any
    >;
    expect(written.banks).toMatchObject({
      project: { enabled: false },
      global: { enabled: true, bankId: "shared" },
    });
    expect(written.hindsight).toMatchObject({ timeoutMs: 1234 });

    await operations.configure(cwd, { memoryProfile: "project-only", globalBankId: "shared" });
    written = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as Record<
      string,
      any
    >;
    expect(written.banks).toMatchObject({
      project: { enabled: true },
      global: { enabled: false },
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

  it("passes query timestamps, explicit entities, and reflect response schemas", async () => {
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

    await operations.recall(cwd, "query", undefined, undefined, "2024-02-01T00:00:00Z");
    await operations.retainExplicit({
      cwd,
      content: "content",
      context: "context",
      entities: [{ text: "Alice", type: "person" }],
    });
    await operations.reflect(cwd, "query", undefined, undefined, {
      type: "object",
      properties: { answer: { type: "string" } },
    });

    expect(calls.find((call) => call.method === "recall")?.options).toMatchObject({
      queryTimestamp: "2024-02-01T00:00:00Z",
    });
    expect(calls.find((call) => call.method === "retain")?.options).toMatchObject({
      entities: [{ text: "Alice", type: "person" }],
    });
    expect(calls.find((call) => call.method === "reflect")?.options).toMatchObject({
      responseSchema: { type: "object", properties: { answer: { type: "string" } } },
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
      banks: { ...DEFAULT_CONFIG.banks, global: { enabled: true, bankId: "global-luxus" } },
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
        deleteDocument: async (bank) => {
          calls.push({ method: "delete", bank });
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
    await operations.deleteDocument({ bank: "global", documentId: "doc" });

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "recall", bank: "global-luxus" },
        { method: "retain", bank: "global-luxus" },
        { method: "reflect", bank: "project-bank" },
        { method: "delete", bank: "global-luxus" },
      ]),
    );
  });
});
