import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operations.js";
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

  it("checks the active global bank in global-only diagnostics", async () => {
    const checkedBanks: string[] = [];
    const operations = createMemoryOperations({
      getClient: () => ({
        ...client(),
        getBankProfile: async (bankId: string) => {
          checkedBanks.push(bankId);
          return {};
        },
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        banks: {
          project: { enabled: false, derive: "repo" },
          global: { enabled: true, bankId: "global-bank" },
        },
      }),
      getProjectBankId: () => "project-bank",
    });
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ops-"));

    await operations.doctor(cwd);
    await operations.debug({ cwd, ui: {} as any, sessionManager: {} as any } as any);

    expect(checkedBanks).toEqual(["global-bank", "global-bank"]);
  });

  it("passes query timestamps, explicit entities, and reflect response schemas", async () => {
    const calls: Array<{ method: string; options?: unknown }> = [];
    const operations = createMemoryOperations({
      getClient: () => ({
        retain: async (_bank, _content, options) => {
          calls.push({ method: "retain", options });
        },
        recall: async (_bank, _query, options) => {
          calls.push({ method: "recall", options });
          return [];
        },
        reflect: async (_bank, _query, options) => {
          calls.push({ method: "reflect", options });
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
});
