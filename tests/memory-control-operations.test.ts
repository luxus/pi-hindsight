import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { createControlOperations } from "../extensions/operations/memory-control-operations.js";

describe("memory control operations", () => {
  it("status reports setup required on fresh cwd", () => {
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
    const status = ops.status(cwd);
    expect(status.setupComplete).toBe(false);
    expect(status.fields.some((f) => f.key === "setup" && f.tone === "warn")).toBe(true);
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
});
