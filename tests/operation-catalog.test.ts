import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createOperationCatalog } from "../extensions/operation-catalog.js";
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
    updateBankConfig: async () => ({ config: {}, overrides: { recall_budget_function: "fixed" } }),
    resetBankConfig: async () => ({ ok: true }),
    getBankTemplateSchema: async () => ({ title: "BankTemplateManifest", properties: {} }),
    listDirectives: async () => ({ items: [] }),
    getDirective: async () => ({ id: "directive", name: "Rule", content: "Use facts." }),
    createDirective: async () => ({ id: "directive", name: "Rule", content: "Use facts." }),
    updateDirective: async () => ({ id: "directive", name: "Rule", content: "Updated." }),
    deleteDirective: async () => ({ deleted: true }),
    exportBankTemplate: async () => ({ version: "1" }),
    listOperations: async () => ({ items: [] }),
    cancelOperation: async () => ({ status: "cancelled" }),
    retryOperation: async () => ({ status: "pending" }),
    listMemories: async () => ({ items: [] }),
    getMemory: async () => ({ id: "memory" }),
    getChunk: async () => ({ id: "chunk" }),
    getMemoryHistory: async () => ({ items: [] }),
    deleteMemoryObservations: async () => ({ deleted: true }),
    retainFiles: async () => ({ operation_ids: ["op-file"] }),
    listMentalModels: async () => ({ items: [] }),
    getMentalModel: async () => ({ id: "mm-1", name: "Model", tags: [] }),
    createMentalModel: async () => ({ id: "mm-1" }),
    updateMentalModel: async () => ({ id: "mm-1" }),
    deleteMentalModel: async () => ({ deleted: true }),
    getMentalModelHistory: async () => ({ items: [] }),
    refreshMentalModel: async () => ({ operation_id: "op-mm" }),
    triggerConsolidation: async () => ({ operation_id: "op-c" }),
    recoverConsolidation: async () => ({ operation_id: "op-r" }),
    clearObservations: async () => ({ cleared: true }),
    listDocuments: async () => ({ items: [] }),
    getDocument: async () => ({ id: "document" }),
    updateDocument: async () => ({ id: "document", tags: [] }),
    listEntities: async () => ({ items: [] }),
    getEntity: async () => ({ id: "entity" }),
    regenerateEntity: async () => ({ id: "entity", status: "queued" }),
    getGraph: async () => ({ nodes: [], edges: [] }),
    getEntityGraph: async () => ({ nodes: [], edges: [] }),
    listTags: async () => ({ items: [] }),
    getBankProfile: async () => ({ id: "bank" }),
    updateBankProfile: async () => ({ id: "bank" }),
    updateBankDisposition: async () => ({ id: "bank", disposition: {} }),
    addBankBackground: async () => ({ id: "bank", background: "added" }),
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
    expect(properties.maxTokens?.type).toBe("integer");
    expect(properties.maxTokens?.minimum).toBe(0);
    expect(properties.includeChunks?.type).toBe("boolean");
    expect(properties.recallChunksMaxTokens?.type).toBe("integer");
    expect(properties.includeSourceFacts?.type).toBe("boolean");
    expect(properties.maxSourceFactsTokens?.type).toBe("integer");
    expect(properties.includeEntities?.type).toBe("boolean");
    expect(properties.trace?.type).toBe("boolean");

    await tool.execute(
      "call",
      {
        query: "find source context",
        types: ["world", "observation"],
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

  it("requires confirm true for destructive public tool schemas", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    expect(
      (requireTool(catalog, "hindsight_reset_bank_config").parameters as JsonSchema).properties
        ?.confirm?.const,
    ).toBe(true);
    expect(
      (requireTool(catalog, "hindsight_delete_directive").parameters as JsonSchema).properties
        ?.confirm?.const,
    ).toBe(true);
    expect(
      (requireTool(catalog, "hindsight_cancel_operation").parameters as JsonSchema).properties
        ?.confirm?.const,
    ).toBe(true);
    expect(
      (requireTool(catalog, "hindsight_delete_memory_observations").parameters as JsonSchema)
        .properties?.confirm?.const,
    ).toBe(true);
  });

  it("maps operation and memory inspection tools to client calls", async () => {
    const calls: unknown[] = [];
    const catalog = createOperationCatalog({
      getClient: () => ({
        ...client(),
        listOperations: async (bank, options) => {
          calls.push({ method: "listOperations", bank, options });
          return { items: [{ id: "op-1", status: "failed", task_type: "retain" }] };
        },
        cancelOperation: async (bank, operationId) => {
          calls.push({ method: "cancelOperation", bank, operationId });
          return { id: operationId, status: "cancelled" };
        },
        retryOperation: async (bank, operationId) => {
          calls.push({ method: "retryOperation", bank, operationId });
          return { id: operationId, status: "pending" };
        },
        listMemories: async (bank, options) => {
          calls.push({ method: "listMemories", bank, options });
          return { items: [{ id: "mem-1", type: "observation" }] };
        },
        getMemory: async (bank, memoryId) => {
          calls.push({ method: "getMemory", bank, memoryId });
          return { id: memoryId };
        },
        getChunk: async (chunkId) => {
          calls.push({ method: "getChunk", chunkId });
          return { id: chunkId };
        },
        getMemoryHistory: async (bank, memoryId) => {
          calls.push({ method: "getMemoryHistory", bank, memoryId });
          return { items: [] };
        },
        deleteMemoryObservations: async (bank, memoryId) => {
          calls.push({ method: "deleteMemoryObservations", bank, memoryId });
          return { deleted: true };
        },
        listDocuments: async (bank, options) => {
          calls.push({ method: "listDocuments", bank, options });
          return { items: [{ id: "doc-1", tags: ["source:pi"] }] };
        },
        getDocument: async (bank, documentId) => {
          calls.push({ method: "getDocument", bank, documentId });
          return { id: documentId };
        },
        updateDocument: async (bank, documentId, request) => {
          calls.push({ method: "updateDocument", bank, documentId, request });
          return { id: documentId, tags: request.tags };
        },
        listEntities: async (bank, options) => {
          calls.push({ method: "listEntities", bank, options });
          return { items: [{ id: "entity-1", text: "Alice" }] };
        },
        getEntity: async (bank, entityId) => {
          calls.push({ method: "getEntity", bank, entityId });
          return { id: entityId };
        },
        regenerateEntity: async (bank, entityId) => {
          calls.push({ method: "regenerateEntity", bank, entityId });
          return { id: entityId, status: "queued" };
        },
        getGraph: async (bank, options) => {
          calls.push({ method: "getGraph", bank, options });
          return { nodes: [], edges: [] };
        },
        getEntityGraph: async (bank, options) => {
          calls.push({ method: "getEntityGraph", bank, options });
          return { nodes: [], edges: [] };
        },
        listTags: async (bank, options) => {
          calls.push({ method: "listTags", bank, options });
          return { items: [{ tag: "source:pi", count: 1 }] };
        },
        getBankProfile: async (bank) => {
          calls.push({ method: "getBankProfile", bank });
          return { id: bank };
        },
        updateBankProfile: async (bank, request) => {
          calls.push({ method: "updateBankProfile", bank, request });
          return { id: bank, ...request };
        },
        updateBankDisposition: async (bank, disposition) => {
          calls.push({ method: "updateBankDisposition", bank, disposition });
          return { id: bank, disposition };
        },
        addBankBackground: async (bank, request) => {
          calls.push({ method: "addBankBackground", bank, request });
          return { id: bank, ...request };
        },
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const ctx = { cwd: "/repo", sessionManager: {} } as never;

    await requireTool(catalog, "hindsight_list_operations").execute(
      "call",
      { status: "failed", taskType: "retain", limit: 2, offset: 1 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_cancel_operation").execute(
      "call",
      { operationId: "op-1", confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_retry_operation").execute(
      "call",
      { operationId: "op-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_list_memories").execute(
      "call",
      { type: "observation", q: "needle", limit: 3, offset: 0 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_memory").execute(
      "call",
      { memoryId: "mem-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_chunk").execute(
      "call",
      { chunkId: "chunk-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_memory_history").execute(
      "call",
      { memoryId: "mem-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_delete_memory_observations").execute(
      "call",
      { memoryId: "mem-1", confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_list_documents").execute(
      "call",
      { tags: ["source:pi"], tagsMatch: "all_strict", limit: 2, offset: 1 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_document").execute(
      "call",
      { documentId: "doc-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_update_document_tags").execute(
      "call",
      { documentId: "doc-1", tags: ["source:pi", "repo:x"], confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_list_entities").execute(
      "call",
      { limit: 3, offset: 0 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_entity").execute(
      "call",
      { entityId: "entity-1" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_regenerate_entity").execute(
      "call",
      { entityId: "entity-1", confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_graph").execute(
      "call",
      { type: "world", q: "Alice", limit: 4, tags: ["source:pi"], tagsMatch: "any_strict" },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_entity_graph").execute(
      "call",
      { limit: 5, minCount: 2 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_list_tags").execute(
      "call",
      { source: "memories", limit: 6 },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_get_bank_profile").execute(
      "call",
      {},
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_update_bank_profile").execute(
      "call",
      { reflectMission: "Use evidence", confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_update_bank_disposition").execute(
      "call",
      { skepticism: 3, literalism: 4, empathy: 5, confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );
    await requireTool(catalog, "hindsight_add_bank_background").execute(
      "call",
      { content: "Project background", updateDisposition: false, confirm: true },
      new AbortController().signal,
      () => undefined,
      ctx,
    );

    expect(calls).toEqual([
      {
        method: "listOperations",
        bank: "project-bank",
        options: { status: "failed", taskType: "retain", limit: 2, offset: 1 },
      },
      { method: "cancelOperation", bank: "project-bank", operationId: "op-1" },
      { method: "retryOperation", bank: "project-bank", operationId: "op-1" },
      {
        method: "listMemories",
        bank: "project-bank",
        options: { type: "observation", q: "needle", limit: 3, offset: 0 },
      },
      { method: "getMemory", bank: "project-bank", memoryId: "mem-1" },
      { method: "getChunk", chunkId: "chunk-1" },
      { method: "getMemoryHistory", bank: "project-bank", memoryId: "mem-1" },
      { method: "deleteMemoryObservations", bank: "project-bank", memoryId: "mem-1" },
      {
        method: "listDocuments",
        bank: "project-bank",
        options: { tags: ["source:pi"], tagsMatch: "all_strict", limit: 2, offset: 1 },
      },
      { method: "getDocument", bank: "project-bank", documentId: "doc-1" },
      {
        method: "updateDocument",
        bank: "project-bank",
        documentId: "doc-1",
        request: { tags: ["source:pi", "repo:x"] },
      },
      { method: "listEntities", bank: "project-bank", options: { limit: 3, offset: 0 } },
      { method: "getEntity", bank: "project-bank", entityId: "entity-1" },
      { method: "regenerateEntity", bank: "project-bank", entityId: "entity-1" },
      {
        method: "getGraph",
        bank: "project-bank",
        options: {
          type: "world",
          q: "Alice",
          limit: 4,
          tags: ["source:pi"],
          tagsMatch: "any_strict",
        },
      },
      { method: "getEntityGraph", bank: "project-bank", options: { limit: 5, minCount: 2 } },
      { method: "listTags", bank: "project-bank", options: { source: "memories", limit: 6 } },
      { method: "getBankProfile", bank: "project-bank" },
      { method: "getBankProfile", bank: "project-bank" },
      {
        method: "updateBankProfile",
        bank: "project-bank",
        request: { reflectMission: "Use evidence" },
      },
      { method: "getBankProfile", bank: "project-bank" },
      {
        method: "updateBankDisposition",
        bank: "project-bank",
        disposition: { skepticism: 3, literalism: 4, empathy: 5 },
      },
      { method: "getBankProfile", bank: "project-bank" },
      {
        method: "addBankBackground",
        bank: "project-bank",
        request: { content: "Project background", updateDisposition: false },
      },
    ]);
  });

  it("passes nullable directive updates through the public tool surface", async () => {
    const updateDirective = vi.fn(async () => ({ id: "directive", content: "Updated" }));
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), updateDirective }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = catalog.tools.find((candidate) => candidate.name === "hindsight_update_directive");

    await tool?.execute(
      "call",
      { directiveId: "directive", bank: "target-bank", content: null, tags: null },
      new AbortController().signal,
      () => undefined,
      { cwd: "/repo", sessionManager: {} } as never,
    );

    expect(updateDirective).toHaveBeenCalledWith("target-bank", "directive", {
      content: null,
      tags: null,
    });
  });

  it("declares the public tool and command surface in one catalog", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "hindsight_recall",
      "hindsight_retain",
      "hindsight_retain_global",
      "hindsight_retain_files",
      "hindsight_retain_receipts",
      "hindsight_route_memory",
      "hindsight_delete_document",
      "hindsight_list_documents",
      "hindsight_get_document",
      "hindsight_update_document_tags",
      "hindsight_list_entities",
      "hindsight_get_entity",
      "hindsight_regenerate_entity",
      "hindsight_get_graph",
      "hindsight_get_entity_graph",
      "hindsight_list_tags",
      "hindsight_list_mental_models",
      "hindsight_get_mental_model",
      "hindsight_create_mental_model",
      "hindsight_promote_reflect_query_to_mental_model",
      "hindsight_update_mental_model",
      "hindsight_delete_mental_model",
      "hindsight_get_mental_model_history",
      "hindsight_refresh_mental_model",
      "hindsight_trigger_consolidation",
      "hindsight_recover_consolidation",
      "hindsight_clear_observations",
      "hindsight_inspect_retain_queue",
      "hindsight_list_operations",
      "hindsight_cancel_operation",
      "hindsight_retry_operation",
      "hindsight_list_memories",
      "hindsight_get_memory",
      "hindsight_get_chunk",
      "hindsight_get_memory_history",
      "hindsight_delete_memory_observations",
      "hindsight_configure",
      "hindsight_get_bank_config",
      "hindsight_update_bank_config",
      "hindsight_get_bank_profile",
      "hindsight_update_bank_profile",
      "hindsight_update_bank_disposition",
      "hindsight_add_bank_background",
      "hindsight_reset_bank_config",
      "hindsight_list_directives",
      "hindsight_get_directive",
      "hindsight_create_directive",
      "hindsight_update_directive",
      "hindsight_delete_directive",
      "hindsight_get_bank_template_schema",
      "hindsight_export_bank_template",
      "hindsight_import_bank_template",
      "hindsight_import",
      "hindsight_import_seed_content",
      "hindsight_import_chat_transcript",
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
