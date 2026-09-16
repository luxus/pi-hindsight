import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  createControlOperations,
  projectMentalModelListMetadata,
} from "../extensions/operations/memory-control-operations.js";

describe("memory control operations", () => {
  it("status reports setup required on fresh cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-"));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "pi-project-x",
    });
    const status = await ops.status(cwd);
    expect(status.setupComplete).toBe(false);
    expect(status.fields.some((f) => f.key === "setup" && f.tone === "warn")).toBe(true);
    expect(status.sync).toMatchObject({
      queue: expect.objectContaining({ active: expect.any(Number) }),
      knowledgePages: expect.any(String),
    });
  });

  it("mental model create defaults project tags and supports dry-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-mm-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), JSON.stringify({ setupComplete: true }));
    const createMentalModel = vi.fn(async () => ({ mental_model_id: "mm1" }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        createMentalModel,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    const dry = await ops.mentalModel({
      action: "create",
      cwd,
      name: "Architecture",
      sourceQuery: "What is the architecture?",
      dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, bankId: "coding" });
    expect((dry as { wouldCreate: { tags: string[] } }).wouldCreate.tags).toEqual(
      expect.arrayContaining(["source:pi", expect.stringMatching(/^project:/)]),
    );
    expect(createMentalModel).not.toHaveBeenCalled();

    // Create defaults dry-run; must opt in to write.
    await ops.mentalModel({
      action: "create",
      cwd,
      name: "Architecture",
      sourceQuery: "What is the architecture?",
      dryRun: false,
    });
    expect(createMentalModel).toHaveBeenCalledWith(
      "coding",
      "Architecture",
      "What is the architecture?",
      expect.objectContaining({
        tags: expect.arrayContaining(["source:pi"]),
        trigger: { refreshAfterConsolidation: true },
      }),
    );
  });

  it("delete mental model defaults to dry-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-del-"));
    const deleteMentalModel = vi.fn(async (_b, _id, opts) => ({ dryRun: opts?.dryRun }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        deleteMentalModel,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });
    await ops.mentalModel({ action: "delete", cwd, id: "mm1" });
    expect(deleteMentalModel).toHaveBeenCalledWith("coding", "mm1", { dryRun: true });
  });

  it("mental model list returns metadata only and omits content/reflect payloads", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-mm-list-"));
    const listMentalModels = vi.fn(async () => ({
      items: [
        {
          id: "mm1",
          name: "Architecture",
          tags: ["source:pi", "project:demo"],
          max_tokens: 1200,
          last_refreshed_at: "2026-03-01T00:00:00Z",
          content: "Huge curated markdown that must not reach the agent on list.",
          bank_id: "coding",
          source_query: "What is the architecture?",
          reflect_response: {
            text: "full reflection",
            based_on: [{ id: "fact-1", text: "nested source fact" }],
          },
        },
      ],
    }));
    const getMentalModel = vi.fn(async () => ({
      id: "mm1",
      name: "Architecture",
      content: "Full model content for get.",
      reflect_response: {
        text: "full reflection",
        based_on: [{ id: "fact-1", text: "nested source fact" }],
      },
    }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        listMentalModels,
        getMentalModel,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    const listed = await ops.mentalModel({ action: "list", cwd });
    expect(listMentalModels).toHaveBeenCalledWith("coding", { detail: "metadata" });
    expect(listed).toEqual({
      bankId: "coding",
      result: {
        items: [
          {
            id: "mm1",
            name: "Architecture",
            tags: ["source:pi", "project:demo"],
            max_tokens: 1200,
            last_refreshed_at: "2026-03-01T00:00:00Z",
          },
        ],
      },
    });
    const listedJson = JSON.stringify(listed);
    expect(listedJson).not.toContain("content");
    expect(listedJson).not.toContain("reflect_response");
    expect(listedJson).not.toContain("based_on");
    expect(listedJson).not.toContain("Huge curated markdown");
    expect(listedJson).not.toContain("nested source fact");

    const got = await ops.mentalModel({ action: "get", cwd, id: "mm1" });
    expect(getMentalModel).toHaveBeenCalledWith("coding", "mm1");
    expect(got).toEqual({
      bankId: "coding",
      result: {
        id: "mm1",
        name: "Architecture",
        content: "Full model content for get.",
        reflect_response: {
          text: "full reflection",
          based_on: [{ id: "fact-1", text: "nested source fact" }],
        },
      },
    });
  });

  it("projectMentalModelListMetadata strips non-metadata fields from alternate shapes", () => {
    const projected = projectMentalModelListMetadata({
      mental_models: [
        {
          id: "x",
          name: "X",
          maxTokens: 50,
          lastRefreshedAt: "2026-01-01T00:00:00Z",
          content: "nope",
          reflect_response: { based_on: ["secret-fact"] },
        },
      ],
    });
    expect(projected).toEqual({
      items: [
        {
          id: "x",
          name: "X",
          max_tokens: 50,
          last_refreshed_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /content|reflect_response|based_on|nope|secret-fact/,
    );
  });

  it("config get returns allowlisted view without secrets", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cfg-get-"));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        hindsight: {
          ...DEFAULT_CONFIG.hindsight,
          apiKey: "sk-secret",
          apiKeyRef: "env:HINDSIGHT_API_KEY",
        },
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "kai-coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "kai-coding",
    });
    const got = await ops.config({ action: "get", cwd });
    expect(got.allowlist).toContain("projectBankId");
    expect((got as { values: { projectBankId?: string } }).values.projectBankId).toBe("kai-coding");
    expect(JSON.stringify(got)).not.toContain("sk-secret");
    expect((got as { values: { apiKeyEnvVar?: string } }).values.apiKeyEnvVar).toBe(
      "HINDSIGHT_API_KEY",
    );
  });

  it("config patch rejects unknown keys and dry-runs by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cfg-patch-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    let reloads = 0;
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "coding",
      reloadConfig: () => {
        reloads += 1;
      },
    });

    await expect(ops.config({ action: "patch", cwd, patch: { notAKey: true } })).rejects.toThrow(
      /not allowlisted/i,
    );

    await expect(
      ops.config({
        action: "patch",
        cwd,
        patch: { includeSharedObservations: "yes" as unknown as boolean },
      }),
    ).rejects.toThrow(/must be a boolean/i);

    await expect(
      ops.config({ action: "patch", cwd, patch: { setupComplete: true } }),
    ).rejects.toThrow(/projectBankId/i);

    const dry = await ops.config({
      action: "patch",
      cwd,
      patch: { projectBankId: "kai-coding", includeSharedObservations: true },
    });
    expect(dry).toMatchObject({ dryRun: true });
    expect((dry as { wouldPatch: Record<string, unknown> }).wouldPatch).toEqual({
      projectBankId: "kai-coding",
      includeSharedObservations: true,
    });
    expect(reloads).toBe(0);

    const written = await ops.config({
      action: "patch",
      cwd,
      patch: { projectBankId: "kai-coding", setupComplete: true },
      dryRun: false,
    });
    expect(written).toMatchObject({ dryRun: false, path: expect.stringContaining("hindsight") });
    expect(reloads).toBe(1);
    const disk = JSON.parse(readFileSync(join(cwd, ".pi", "hindsight.json"), "utf8")) as {
      setupComplete?: boolean;
      banks?: { project?: { bankId?: string } };
    };
    expect(disk.setupComplete).toBe(true);
    expect(disk.banks?.project?.bankId).toBe("kai-coding");
  });

  it("knowledge create_page defaults project tags and dry-runs by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-kp-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), JSON.stringify({ setupComplete: true }));
    const createKnowledgePage = vi.fn(async () => ({ page_id: "kp1", operation_id: "op1" }));
    const searchKnowledgeBase = vi.fn(async () => ({ results: [], total: 0 }));
    const getKnowledgePage = vi.fn(async () => ({ id: "kp1", markdown: "# x" }));
    const getKnowledgeBaseTree = vi.fn(async () => ({ roots: [] }));
    const deleteKnowledgeNode = vi.fn(async () => undefined);
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        createKnowledgePage,
        searchKnowledgeBase,
        getKnowledgePage,
        getKnowledgeBaseTree,
        deleteKnowledgeNode,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    const dry = await ops.knowledge({
      action: "create_page",
      cwd,
      name: "Deploy",
      sourceQuery: "How do we deploy?",
    });
    expect(dry).toMatchObject({ dryRun: true, bankId: "coding" });
    expect((dry as { wouldCreate: { tags: string[] } }).wouldCreate.tags).toEqual(
      expect.arrayContaining(["source:pi", expect.stringMatching(/^project:/)]),
    );
    expect(createKnowledgePage).not.toHaveBeenCalled();

    await ops.knowledge({
      action: "create_page",
      cwd,
      name: "Deploy",
      sourceQuery: "How do we deploy?",
      dryRun: false,
    });
    expect(createKnowledgePage).toHaveBeenCalledWith(
      "coding",
      "Deploy",
      "How do we deploy?",
      expect.objectContaining({
        tags: expect.arrayContaining(["source:pi"]),
      }),
    );

    await ops.knowledge({ action: "search", cwd, query: "deploy", limit: 3 });
    expect(searchKnowledgeBase).toHaveBeenCalledWith("coding", "deploy", { limit: 3 });

    await ops.knowledge({ action: "get", cwd, id: "kp1" });
    expect(getKnowledgePage).toHaveBeenCalledWith("coding", "kp1");

    await ops.knowledge({ action: "tree", cwd });
    expect(getKnowledgeBaseTree).toHaveBeenCalledWith("coding");

    const exportKnowledgeBase = vi.fn(async () => ({ files: [] }));
    const opsWithExport = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        exportKnowledgeBase,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });
    await opsWithExport.knowledge({ action: "export", cwd });
    expect(exportKnowledgeBase).toHaveBeenCalledWith("coding");

    const delDry = await ops.knowledge({ action: "delete", cwd, id: "kp1" });
    expect(delDry).toMatchObject({ dryRun: true, wouldDelete: true });
    expect(deleteKnowledgeNode).not.toHaveBeenCalled();
  });

  it("mental model create passes tagsMatch on trigger", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-mm-tm-"));
    const createMentalModel = vi.fn(async () => ({ mental_model_id: "mm1" }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        createMentalModel,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });
    await ops.mentalModel({
      action: "create",
      cwd,
      name: "Arch",
      sourceQuery: "architecture?",
      tagsMatch: "any",
      dryRun: false,
    });
    expect(createMentalModel).toHaveBeenCalledWith(
      "coding",
      "Arch",
      "architecture?",
      expect.objectContaining({
        trigger: { refreshAfterConsolidation: true, tagsMatch: "any" },
      }),
    );
  });

  it("knowledge fails clearly when client lacks knowledge-base methods", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-ctrl-kp-miss-"));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });
    await expect(ops.knowledge({ action: "tree", cwd })).rejects.toThrow(
      /does not support getKnowledgeBaseTree/i,
    );
  });

  it("bank mission and mm create default to dry-run at the op layer", async () => {
    const updateBankConfig = vi.fn(async () => ({ ok: true }));
    const createMentalModel = vi.fn(async () => ({ id: "mm1" }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        updateBankConfig,
        createMentalModel,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    const mission = await ops.bankUpdateMission({ retainMission: "code" });
    expect(mission).toMatchObject({ dryRun: true });
    expect(updateBankConfig).not.toHaveBeenCalled();

    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-mm-dry-"));
    const created = await ops.mentalModel({
      action: "create",
      cwd,
      name: "X",
      sourceQuery: "q",
    });
    expect(created).toMatchObject({ dryRun: true });
    expect(createMentalModel).not.toHaveBeenCalled();
  });

  it("bankGet uses list-banks existence and still returns stats/config when profile is 410", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("The bank profile endpoints have been removed."), {
        status: 410,
      });
    });
    const getBankStats = vi.fn(async () => ({ document_count: 4 }));
    const getBankConfig = vi.fn(async () => ({
      config: { retain_mission: "From config" },
      overrides: {},
    }));
    const listBanks = vi.fn(async () => ({ banks: [{ bank_id: "coding" }] }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        getBankProfile,
        getBankStats,
        getBankConfig,
        listBanks,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    await expect(ops.bankGet({})).resolves.toEqual({
      bankId: "coding",
      exists: true,
      stats: { document_count: 4 },
      config: { config: { retain_mission: "From config" }, overrides: {} },
    });
    expect(listBanks).toHaveBeenCalledWith(expect.objectContaining({ q: "coding" }));
    expect(getBankProfile).not.toHaveBeenCalled();
    expect(getBankStats).toHaveBeenCalledWith("coding");
    expect(getBankConfig).toHaveBeenCalledWith("coding");
  });

  it("bankGet reports exists false on list miss and still returns stats/config", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("The bank profile endpoints have been removed."), {
        status: 410,
      });
    });
    const getBankStats = vi.fn(async () => ({ document_count: 0 }));
    const getBankConfig = vi.fn(async () => ({
      config: { retain_mission: "Config 200s for missing banks" },
      overrides: {},
    }));
    const listBanks = vi.fn(async () => ({ banks: [{ bank_id: "coding-extra" }] }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        getBankProfile,
        getBankStats,
        getBankConfig,
        listBanks,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    await expect(ops.bankGet({})).resolves.toEqual({
      bankId: "coding",
      exists: false,
      stats: { document_count: 0 },
      config: { config: { retain_mission: "Config 200s for missing banks" }, overrides: {} },
    });
    expect(getBankProfile).not.toHaveBeenCalled();
    expect(getBankStats).toHaveBeenCalledWith("coding");
    expect(getBankConfig).toHaveBeenCalledWith("coding");
  });

  it("bankGet still returns stats/config when profile is retired and list-banks is unavailable", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("The bank profile endpoints have been removed."), {
        statusCode: 410,
      });
    });
    const getBankStats = vi.fn(async () => ({ document_count: 9 }));
    const getBankConfig = vi.fn(async () => ({
      config: { reflect_mission: "Still readable" },
      overrides: {},
    }));
    const ops = createControlOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        getBankProfile,
        getBankStats,
        getBankConfig,
      }),
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "coding", derive: "manual" as const },
        },
      }),
      getProjectBankId: () => "coding",
    });

    await expect(ops.bankGet({})).resolves.toEqual({
      bankId: "coding",
      exists: null,
      stats: { document_count: 9 },
      config: { config: { reflect_mission: "Still readable" }, overrides: {} },
    });
    expect(getBankProfile).toHaveBeenCalledWith("coding");
    expect(getBankStats).toHaveBeenCalledWith("coding");
    expect(getBankConfig).toHaveBeenCalledWith("coding");
  });
});
