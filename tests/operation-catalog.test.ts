import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { createOperationCatalog } from "../extensions/operations/operation-catalog.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";

type RetainOptions = Parameters<HindsightLikeClient["retain"]>[2];
type RecallOptions = Parameters<HindsightLikeClient["recall"]>[2];
type ReflectOptions = Parameters<HindsightLikeClient["reflect"]>[2];

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  const?: unknown;
  minimum?: number;
};

function client(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    getBankConfig: async () => ({ config: {}, overrides: {} }),
    getBankProfile: async () => ({ id: "bank" }),
  };
}

function retainMock() {
  return vi.fn(async (_bankId: string, _content: string, _options?: RetainOptions) => undefined);
}

function requireTool(catalog: ReturnType<typeof createOperationCatalog>, name: string) {
  const tool = catalog.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing ${name} tool`);
  return tool;
}

describe("operation catalog", () => {
  it("registers expandable renderers for explicit memory tool results", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    for (const name of [
      "hindsight_recall",
      "hindsight_retain",
      "hindsight_retain_global",
      "hindsight_reflect",
    ]) {
      expect(requireTool(catalog, name).renderResult).toBeTypeOf("function");
    }
  });

  it("exposes and maps advanced explicit retain options on the project retain tool", async () => {
    const retain = retainMock();
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const sessionFile = join(cwd, "session.jsonl");
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), retain }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = requireTool(catalog, "hindsight_retain");
    const properties = (tool.parameters as JsonSchema).properties ?? {};

    expect(properties.documentId?.type).toBe("string");
    expect(properties.timestamp?.type).toBe("string");
    expect(properties.metadata?.patternProperties?.["^.*$"]?.type).toBe("string");
    expect(properties.updateMode?.anyOf?.map((schema) => schema.const)).toEqual([
      "append",
      "replace",
    ]);
    expect(properties.observationScopes?.anyOf?.some((entry) => entry.const === "per_tag")).toBe(
      true,
    );
    expect(properties.observationScopes?.anyOf?.some((entry) => entry.const === "combined")).toBe(
      true,
    );
    expect(properties.observationScopes?.anyOf?.some((entry) => entry.const === "shared")).toBe(
      true,
    );
    expect(properties.documentTags?.items?.type).toBe("string");
    expect(properties.async?.type).toBe("boolean");

    await tool.execute(
      "call",
      {
        content: "Remember exact decision",
        context: "unit test retain tool",
        bank: "target-bank",
        tags: ["decision:test"],
        entities: [{ text: "Alice", type: "person" }],
        documentId: "manual-doc",
        timestamp: "unset",
        metadata: {
          cwd: "wrong-cwd",
          pi_session_file: "wrong-session",
          source: "wrong-source",
          retainSource: "wrong-retain-source",
          caller: "kept",
        },
        updateMode: "append",
        observationScopes: "per_tag",
        documentTags: ["doc:manual"],
        async: false,
      },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: { getSessionFile: () => sessionFile } } as never,
    );

    expect(retain).toHaveBeenCalledWith(
      "target-bank",
      "Remember exact decision",
      expect.objectContaining({
        context: "unit test retain tool",
        documentId: "manual-doc",
        timestamp: "unset",
        metadata: {
          cwd,
          pi_session_file: sessionFile,
          source: "pi-hindsight",
          retainSource: "tool",
          caller: "kept",
        },
        updateMode: "append",
        observationScopes: "per_tag",
        documentTags: ["doc:manual"],
        async: false,
        entities: [{ text: "Alice", type: "person" }],
      }),
    );

    retain.mockClear();
    await tool.execute(
      "call",
      {
        content: "Append using deterministic explicit document ID",
        context: "unit test append default document ID",
        updateMode: "append",
      },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: { getSessionFile: () => sessionFile } } as never,
    );

    expect(retain).toHaveBeenCalledWith(
      "project-bank",
      "Append using deterministic explicit document ID",
      expect.objectContaining({
        context: "unit test append default document ID",
        documentId: expect.stringMatching(/^pi-explicit:/),
        updateMode: "append",
      }),
    );
  });

  it("keeps simple retain defaults unchanged when advanced tool options are omitted", async () => {
    const retain = retainMock();
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const sessionFile = join(cwd, "session.jsonl");
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), retain }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const tool = requireTool(catalog, "hindsight_retain");

    await tool.execute(
      "call",
      { content: "Remember simple default", context: "unit test retain defaults" },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: { getSessionFile: () => sessionFile } } as never,
    );

    const options = retain.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).toMatchObject({
      context: "unit test retain defaults",
      updateMode: "replace",
      async: true,
      metadata: {
        cwd,
        pi_session_file: sessionFile,
        source: "pi-hindsight",
        retainSource: "tool",
      },
      observationScopes: [["harness:pi"], [expect.stringMatching(/^repo:/)]],
    });
    expect(options.documentId).toEqual(expect.stringMatching(/^pi-explicit:/));
    expect(options.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        expect.stringMatching(/^repo:/),
        expect.stringMatching(/^session:/),
      ]),
    );
  });

  it("exposes and maps advanced explicit recall controls", async () => {
    const recall = vi.fn(async (_bankId: string, _query: string, _options?: RecallOptions) => ({
      ok: true,
    }));
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), recall }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = requireTool(catalog, "hindsight_recall");
    const properties = (tool.parameters as JsonSchema).properties ?? {};

    expect(properties.types?.items?.anyOf?.map((schema) => schema.const)).toEqual([
      "world",
      "experience",
      "observation",
    ]);
    expect(properties.budget?.anyOf?.map((schema) => schema.const)).toEqual(["low", "mid", "high"]);
    expect(properties.tagsMatch?.anyOf?.map((schema) => schema.const)).toEqual([
      "any",
      "all",
      "any_strict",
      "all_strict",
      "exact",
    ]);
    expect(properties.maxTokens?.type).toBe("integer");
    expect(properties.maxTokens?.minimum).toBe(0);
    expect(properties.includeChunks?.type).toBe("boolean");
    expect(properties.recallChunksMaxTokens?.type).toBe("integer");
    expect(properties.includeSourceFacts?.type).toBe("boolean");
    expect(properties.maxSourceFactsTokens?.type).toBe("integer");
    expect(properties.includeEntities?.type).toBe("boolean");
    expect(properties.trace?.type).toBe("boolean");
    expect(properties.preferObservations?.type).toBe("boolean");
    expect(properties.minScores?.type).toBe("object");

    await tool.execute(
      "call",
      {
        query: "find source context",
        types: ["world", "observation"],
        preferObservations: true,
        minScores: { semantic: 0.2, final: 0.5 },
        budget: "high",
        maxTokens: 0,
        includeChunks: true,
        recallChunksMaxTokens: 512,
        includeSourceFacts: true,
        maxSourceFactsTokens: 256,
        includeEntities: true,
        trace: true,
        tags: ["caller:tag"],
      },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: {} } as never,
    );

    expect(recall).toHaveBeenCalledWith(
      "project-bank",
      "find source context",
      expect.objectContaining({
        types: ["world", "observation"],
        preferObservations: true,
        minScores: { semantic: 0.2, final: 0.5 },
        budget: "high",
        maxTokens: 0,
        includeChunks: true,
        maxChunkTokens: 512,
        includeSourceFacts: true,
        maxSourceFactsTokens: 256,
        includeEntities: true,
        trace: true,
        tagGroups: expect.arrayContaining([
          expect.objectContaining({
            tags: expect.arrayContaining([expect.stringMatching(/^repo:/)]),
          }),
          { tags: ["caller:tag"], match: "any_strict" },
        ]),
      }),
    );
  });

  it("DRAFT #452: hindsight_list_memories lists raw memory units with pagination filters", async () => {
    const listMemories = vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 }));
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), listMemories }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = requireTool(catalog, "hindsight_list_memories");

    await tool.execute(
      "call",
      { limit: 20, state: "invalidated", documentId: "doc-1" },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: {} } as never,
    );

    expect(listMemories).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({ limit: 20, state: "invalidated", documentId: "doc-1" }),
    );
  });

  it("exposes and maps low-risk explicit reflect controls", async () => {
    const reflect = vi.fn(async (_bankId: string, _query: string, _options?: ReflectOptions) => ({
      ok: true,
    }));
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), reflect }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = requireTool(catalog, "hindsight_reflect");
    const properties = (tool.parameters as JsonSchema).properties ?? {};

    expect(properties.budget?.anyOf?.map((schema) => schema.const)).toEqual(["low", "mid", "high"]);
    expect(properties.maxTokens?.type).toBe("integer");
    expect(properties.maxTokens?.minimum).toBe(0);
    expect(properties.includeFacts?.type).toBe("boolean");
    expect(properties.includeToolCalls?.type).toBe("boolean");
    expect(properties.includeToolCallOutput?.type).toBe("boolean");
    expect(properties.factTypes?.type).toBe("array");
    expect(properties.excludeMentalModels?.type).toBe("boolean");
    expect(properties.excludeMentalModelIds?.type).toBe("array");

    await tool.execute(
      "call",
      {
        query: "synthesize",
        budget: "mid",
        maxTokens: 0,
        includeFacts: true,
        includeToolCalls: true,
        tags: ["caller:tag"],
      },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: {} } as never,
    );

    expect(reflect).toHaveBeenCalledWith(
      "project-bank",
      "synthesize",
      expect.objectContaining({
        budget: "mid",
        maxTokens: 0,
        includeFacts: true,
        includeToolCalls: true,
        tagGroups: expect.arrayContaining([
          expect.objectContaining({
            tags: expect.arrayContaining([expect.stringMatching(/^repo:/)]),
          }),
          { tags: ["caller:tag"], match: "any_strict" },
        ]),
      }),
    );
  });

  it("maps advanced explicit retain options on the global retain tool", async () => {
    const retain = retainMock();
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-catalog-"));
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-bank" },
      },
    };
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), retain }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    });
    const tool = requireTool(catalog, "hindsight_retain_global");

    await tool.execute(
      "call",
      {
        content: "Remember global preference",
        context: "unit test global retain tool",
        documentId: "global-doc",
        timestamp: "2026-05-06T00:00:00Z",
        metadata: { caller: "kept", source: "wrong-source", retainSource: "wrong-retain" },
        updateMode: "append",
        observationScopes: [["user:manual"]],
        async: false,
      },
      new AbortController().signal,
      () => undefined,
      { cwd, sessionManager: {} } as never,
    );

    expect(retain).toHaveBeenCalledWith(
      "global-bank",
      "Remember global preference",
      expect.objectContaining({
        documentId: "global-doc",
        timestamp: "2026-05-06T00:00:00Z",
        metadata: { cwd, source: "pi-hindsight", retainSource: "tool", caller: "kept" },
        updateMode: "append",
        observationScopes: [["user:manual"]],
        async: false,
      }),
    );
  });

  it("declares the public tool and command surface in one catalog", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    // DRAFT/DISCUSSION (see #452): hindsight_list_memories addition is the change under
    // discussion, not a decided outcome.
    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "hindsight_recall",
      "hindsight_list_memories",
      "hindsight_retain",
      "hindsight_retain_global",
      "hindsight_reflect",
    ]);

    expect(catalog.commands.map((command) => command.name)).toEqual([
      "hindsight",
      "hindsight:init",
      "hindsight:import",
      "hindsight:import-current",
      "hindsight:import-file",
      "hindsight:import-project-sessions",
      "hindsight:session",
      "hindsight:mode",
      "hindsight:next-opt-out",
      "hindsight:retain",
      "hindsight:tag",
      "hindsight:last-recall",
      "hindsight:recall-cleanup",
      "hindsight:queue",
      "hindsight:flush",
    ]);
  });
});
