import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config-defaults.js";
import {
  buildGuidedSetupGlobalPatch,
  buildGuidedSetupPatch,
  buildIgnoreRepoPatch,
  extractMentalModelNames,
  formatSetupBankStatusLine,
  hasProjectHindsightConfig,
  importChoicesForSetup,
  maybeOfferHistoricalImportForSetup,
  probeBankExistence,
  probeBankMentalModels,
  resolveSetupBankId,
  runGuidedSetup,
  selectMentalModelTargetsToOffer,
  setupProfileChoiceToMemoryProfile,
} from "../extensions/tui/guided-setup.js";

const configuredGlobal = {
  ...DEFAULT_CONFIG,
  banks: {
    ...DEFAULT_CONFIG.banks,
    user: { ...DEFAULT_CONFIG.banks.user, bankId: "global-luxus" },
  },
};

describe("guided setup", () => {
  it("detects project config files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-"));
    expect(hasProjectHindsightConfig(cwd)).toBe(false);
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "not-hindsight.json"), "{}", { flag: "wx" });
    expect(hasProjectHindsightConfig(cwd)).toBe(false);
  });

  it("detects json and jsonc project config files", () => {
    const jsonCwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-json-"));
    const jsoncCwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-jsonc-"));
    mkdirSync(join(jsonCwd, ".pi"));
    mkdirSync(join(jsoncCwd, ".pi"));
    writeFileSync(join(jsonCwd, ".pi", "hindsight.json"), "{}", { flag: "wx" });
    writeFileSync(join(jsoncCwd, ".pi", "hindsight.jsonc"), "{}", { flag: "wx" });

    expect(hasProjectHindsightConfig(jsonCwd)).toBe(true);
    expect(hasProjectHindsightConfig(jsoncCwd)).toBe(true);
  });

  it("maps setup profile choices to config writer profiles", () => {
    expect(setupProfileChoiceToMemoryProfile("project-user")).toBe("project+global");
    expect(setupProfileChoiceToMemoryProfile("project-only")).toBe("project-only");
    expect(setupProfileChoiceToMemoryProfile("user-only")).toBe("global-only");
    expect(setupProfileChoiceToMemoryProfile("recall-only")).toBe("recall-only");
  });

  it("builds durable ignore-repo patch", () => {
    expect(buildIgnoreRepoPatch()).toEqual({
      enabled: false,
      setupComplete: true,
      statusStyle: "off",
    });
  });

  it("builds profile and bank patches without inventing global bank IDs", () => {
    expect(
      buildGuidedSetupPatch({
        profile: "project-only",
        projectBankId: "project-bank",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "project-only",
      setupComplete: true,
      scopeMode: "domain-tagged",
      projectBankId: "project-bank",
    });

    expect(
      buildGuidedSetupPatch({
        profile: "project-user",
        projectBankId: "project-bank",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "project+global",
      setupComplete: true,
      scopeMode: "domain-tagged",
      projectBankId: "project-bank",
      resetDefaults: ["banks.global.bankId"],
    });

    expect(
      buildGuidedSetupPatch({
        profile: "user-only",
        projectBankId: "ignored-project",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "global-only",
      setupComplete: true,
      scopeMode: "domain-tagged",
      resetDefaults: ["banks.global.bankId"],
    });

    expect(
      buildGuidedSetupPatch({
        profile: "recall-only",
        projectBankId: "project-bank",
        globalBankId: "ignored-user",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "recall-only",
      setupComplete: true,
      scopeMode: "domain-tagged",
      projectBankId: "project-bank",
    });
  });

  it("marks isolated profile with isolated-bank scope mode", () => {
    expect(
      buildGuidedSetupPatch({
        profile: "isolated-only",
        projectBankId: "client-acme",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "project-only",
      setupComplete: true,
      scopeMode: "isolated-bank",
      projectBankId: "client-acme",
    });
  });

  it("builds global config patches for user memory profiles", () => {
    expect(
      buildGuidedSetupGlobalPatch({
        profile: "project-user",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({ scope: "global", enableGlobalBank: true, globalBankId: "global-luxus" });
    expect(
      buildGuidedSetupGlobalPatch({
        profile: "user-only",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({ scope: "global", enableGlobalBank: true, globalBankId: "global-luxus" });
    expect(
      buildGuidedSetupGlobalPatch({ profile: "project-only", config: DEFAULT_CONFIG }),
    ).toBeUndefined();
    expect(
      buildGuidedSetupGlobalPatch({ profile: "recall-only", config: DEFAULT_CONFIG }),
    ).toBeUndefined();
  });

  it("writes project config without a template step", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-run-"));
    const notify = vi.fn();
    const ctx = {
      cwd,
      sessionManager: { getSessionFile: () => undefined },
      ui: {
        notify,
        input: vi.fn().mockResolvedValueOnce("project-bank"),
        select: vi
          .fn()
          .mockResolvedValueOnce("Project Only")
          .mockResolvedValueOnce("Coding (architecture, conventions, decisions)"),
        // Write config yes; skip mental models; skip import.
        confirm: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false),
      },
    } as never;

    const completed = await runGuidedSetup({
      ctx,
      cwd,
      deps: {
        getClient: () => ({
          retain: vi.fn(),
          recall: vi.fn(),
          reflect: vi.fn(),
          health: vi.fn(async () => ({ status: "ok" })),
        }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "project-bank",
      } as never,
    });

    expect(completed).toBe(true);
    expect(hasProjectHindsightConfig(cwd)).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(`Wrote ${join(cwd, ".pi", "hindsight.json")}`),
      "info",
    );
  });

  it("limits setup import choices to configured setup banks", () => {
    expect(
      importChoicesForSetup({
        setupProfile: "user-only",
        globalBankId: "user-bank",
      }),
    ).toEqual(["Skip import", "Preview chat transcript"]);
    expect(
      importChoicesForSetup({
        setupProfile: "project-only",
        projectBankId: "project-bank",
      }),
    ).toEqual(["Skip import", "Preview repo Pi sessions"]);
    expect(
      importChoicesForSetup({
        setupProfile: "project-user",
        projectBankId: "project-bank",
        globalBankId: "user-bank",
      }),
    ).toEqual(["Skip import", "Preview repo Pi sessions", "Preview chat transcript"]);
  });

  it("previews repo session import after project setup before writing", async () => {
    const ctx = {
      cwd: "/repo",
      sessionManager: { getSessionFile: () => "/sessions/current.jsonl" },
      ui: {
        confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        select: vi.fn().mockResolvedValueOnce("Preview repo Pi sessions"),
        input: vi.fn(),
        notify: vi.fn(),
      },
    } as never;
    const importProjectSessions = vi.fn().mockResolvedValueOnce({
      bankId: "project-bank",
      sessionFiles: ["/sessions/current.jsonl"],
      imported: [{ documents: [{ updateMode: "replace", status: "pending", messageCount: 2 }] }],
      malformedLineCount: 0,
      documentCount: 1,
      messageCount: 2,
    });
    const operations = {
      importProjectSessions,
      importChatTranscript: vi.fn(),
    } as never;

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations,
      setupProfile: "project-only",
      cwd: "/repo",
      projectBankId: "project-bank",
    });

    expect(importProjectSessions).toHaveBeenCalledWith({
      cwd: "/repo",
      currentSessionFile: "/sessions/current.jsonl",
      bank: "project-bank",
      dryRun: true,
      onProgress: expect.any(Function),
    });
    expect(importProjectSessions).toHaveBeenCalledTimes(1);
  });

  it("previews chat transcript import after user setup before writing", async () => {
    const ctx = {
      ui: {
        confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        select: vi.fn().mockResolvedValueOnce("Preview chat transcript"),
        input: vi.fn().mockResolvedValueOnce("/tmp/chat.jsonl"),
        notify: vi.fn(),
      },
    } as never;
    const importChatTranscript = vi.fn().mockResolvedValueOnce({
      bankId: "user-bank",
      keptEventCount: 3,
      retainedTurnCount: 1,
      droppedEventCount: 2,
      malformedLineCount: 0,
      documentId: "doc",
    });
    const operations = {
      importProjectSessions: vi.fn(),
      importChatTranscript,
    } as never;

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations,
      setupProfile: "user-only",
      cwd: "/repo",
      globalBankId: "user-bank",
    });

    expect(importChatTranscript).toHaveBeenCalledWith({
      sourceFile: "/tmp/chat.jsonl",
      cwd: "/repo",
      bank: "user-bank",
      dryRun: true,
      onProgress: expect.any(Function),
    });
    expect(importChatTranscript).toHaveBeenCalledTimes(1);
  });

  it("uses existing configured global bank ID when profile enables global memory", () => {
    expect(
      buildGuidedSetupPatch({
        profile: "project-user",
        projectBankId: "project-bank",
        config: configuredGlobal,
      }),
    ).toEqual({
      memoryProfile: "project+global",
      setupComplete: true,
      scopeMode: "domain-tagged",
      projectBankId: "project-bank",
      resetDefaults: ["banks.global.bankId"],
    });
    expect(
      buildGuidedSetupGlobalPatch({
        profile: "project-user",
        config: configuredGlobal,
      }),
    ).toEqual({ scope: "global", enableGlobalBank: true, globalBankId: "global-luxus" });
  });

  it("extracts mental model names from list responses", () => {
    expect(
      extractMentalModelNames({
        items: [{ id: "a", name: "Architecture" }, { id: "b", name: "  " }, { id: "c" }],
      }),
    ).toEqual(["Architecture", "b", "c"]);
    expect(extractMentalModelNames({ mental_models: [{ name: "Goals" }] })).toEqual(["Goals"]);
    expect(extractMentalModelNames(null)).toEqual([]);
  });

  it("skips starter mental-model offer when banks already have models", () => {
    const decision = selectMentalModelTargetsToOffer([
      {
        target: "project",
        bankId: "pi-coding",
        bankExists: true,
        modelNames: ["Architecture decisions"],
      },
      {
        target: "user",
        bankId: "life",
        bankExists: false,
        modelNames: [],
      },
      {
        target: "user",
        bankId: "broken",
        bankExists: true,
        modelNames: [],
        error: "timeout",
      },
    ]);
    expect(decision.toOffer.map((probe) => probe.bankId)).toEqual(["life"]);
    expect(decision.alreadyProvisioned.map((probe) => probe.bankId)).toEqual(["pi-coding"]);
    expect(decision.unknown.map((probe) => probe.bankId)).toEqual(["broken"]);
  });

  it("probes bank existence and existing mental models from the API", async () => {
    const getBankProfile = vi
      .fn()
      .mockResolvedValueOnce({ id: "pi-coding" })
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    const listMentalModels = vi.fn().mockResolvedValueOnce({
      items: [{ id: "mm1", name: "Project architecture" }],
    });
    const client = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      getBankProfile,
      listMentalModels,
    };

    await expect(
      probeBankMentalModels({ client, target: "project", bankId: "pi-coding" }),
    ).resolves.toEqual({
      target: "project",
      bankId: "pi-coding",
      bankExists: true,
      modelNames: ["Project architecture"],
    });
    await expect(
      probeBankMentalModels({ client, target: "project", bankId: "new-bank" }),
    ).resolves.toEqual({
      target: "project",
      bankId: "new-bank",
      bankExists: false,
      modelNames: [],
    });
    expect(listMentalModels).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for starter mental models when the bank already has them", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-existing-mm-"));
    const notify = vi.fn();
    const confirm = vi
      .fn()
      // Write config yes; import no. No mental-model confirm should appear.
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const applyBankTemplate = vi.fn();
    const listMentalModels = vi.fn(async () => ({
      items: [{ id: "mm1", name: "Architecture decisions" }],
    }));
    const getBankProfile = vi.fn(async () => ({ id: "project-bank" }));
    const ctx = {
      cwd,
      sessionManager: { getSessionFile: () => undefined },
      ui: {
        notify,
        input: vi.fn().mockResolvedValueOnce("project-bank"),
        select: vi
          .fn()
          .mockResolvedValueOnce("Coding (shared coding bank + project tags)")
          .mockResolvedValueOnce("Coding (architecture, conventions, decisions)"),
        confirm,
      },
    } as never;

    const completed = await runGuidedSetup({
      ctx,
      cwd,
      deps: {
        getClient: () => ({
          retain: vi.fn(),
          recall: vi.fn(),
          reflect: vi.fn(),
          getBankProfile,
          listMentalModels,
          importBankTemplate: applyBankTemplate,
        }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "project-bank",
      } as never,
    });

    expect(completed).toBe(true);
    expect(getBankProfile).toHaveBeenCalledWith("project-bank");
    expect(listMentalModels).toHaveBeenCalledWith("project-bank");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0]?.[0]).toBe("Write Pi Hindsight config?");
    expect(confirm.mock.calls[1]?.[0]).toBe("Preview historical import now?");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Using existing project bank project-bank"),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Server: reachable · project bank project-bank: existing"),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("1 mental model(s) already present"),
      "info",
    );
    expect(applyBankTemplate).not.toHaveBeenCalled();
  });

  it("probes bank existence for typo protection", async () => {
    const getBankProfile = vi
      .fn()
      .mockResolvedValueOnce({ id: "ok" })
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
      .mockRejectedValueOnce(new Error("timeout"));
    const client = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      getBankProfile,
    };
    await expect(probeBankExistence(client, "ok")).resolves.toEqual({ status: "exists" });
    await expect(probeBankExistence(client, "missing")).resolves.toEqual({ status: "missing" });
    await expect(probeBankExistence(client, "broken")).resolves.toEqual({
      status: "unknown",
      error: "timeout",
    });
    await expect(
      probeBankExistence(
        { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
        "x",
      ),
    ).resolves.toEqual({ status: "unknown", error: "getBankProfile unavailable" });
  });

  it("confirms create for missing banks and re-prompts on decline", async () => {
    const notify = vi.fn();
    const input = vi.fn().mockResolvedValueOnce("typo-bank").mockResolvedValueOnce("pi-coding");
    const confirm = vi.fn().mockResolvedValueOnce(false);
    const getBankProfile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
      .mockResolvedValueOnce({ id: "pi-coding" });
    const createBank = vi.fn();
    const client = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      getBankProfile,
      createBank,
    };
    const ctx = {
      ui: { notify, input, confirm, select: vi.fn() },
    } as never;

    const resolved = await resolveSetupBankId({
      ctx,
      client,
      config: DEFAULT_CONFIG,
      kind: "project",
      title: "Coding bank ID",
      fallback: "pi-coding",
    });

    expect(resolved).toEqual({ bankId: "pi-coding", state: "existing" });
    expect(createBank).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      'Create project bank "typo-bank"?',
      expect.stringContaining("typo protection"),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Using existing project bank pi-coding"),
      "info",
    );
  });

  it("creates a missing bank after confirmation", async () => {
    const notify = vi.fn();
    const input = vi.fn().mockResolvedValueOnce("new-coding");
    const confirm = vi.fn().mockResolvedValueOnce(true);
    const getBankProfile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
      // ensureProjectBank re-checks existence before create
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    const createBank = vi.fn(async () => ({ id: "new-coding" }));
    const client = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      getBankProfile,
      createBank,
    };
    const ctx = {
      ui: { notify, input, confirm, select: vi.fn() },
    } as never;

    const resolved = await resolveSetupBankId({
      ctx,
      client,
      config: DEFAULT_CONFIG,
      kind: "project",
      title: "Coding bank ID",
      fallback: "pi-coding",
    });

    expect(resolved).toEqual({ bankId: "new-coding", state: "created" });
    expect(createBank).toHaveBeenCalledWith(
      "new-coding",
      expect.objectContaining({ name: "new-coding" }),
    );
    expect(notify).toHaveBeenCalledWith("Created project bank new-coding.", "info");
  });

  it("formats server and bank status line", () => {
    expect(
      formatSetupBankStatusLine({
        serverReachable: true,
        banks: [{ kind: "project", bankId: "pi-coding", state: "existing" }],
      }),
    ).toBe("Server: reachable · project bank pi-coding: existing");
    expect(
      formatSetupBankStatusLine({
        serverReachable: false,
        banks: [{ kind: "project", bankId: "pi-coding", state: "unverified" }],
      }),
    ).toBe("Server: offline · project bank pi-coding: unverified");
  });

  it("accepts bank ids offline without probing", async () => {
    const getBankProfile = vi.fn();
    const resolved = await resolveSetupBankId({
      ctx: {
        ui: {
          notify: vi.fn(),
          input: vi.fn().mockResolvedValueOnce("offline-bank"),
          confirm: vi.fn(),
        },
      } as never,
      client: {
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        getBankProfile,
      },
      config: DEFAULT_CONFIG,
      kind: "project",
      title: "Coding bank ID",
      fallback: "pi-coding",
      offline: true,
    });
    expect(resolved).toEqual({ bankId: "offline-bank", state: "unverified" });
    expect(getBankProfile).not.toHaveBeenCalled();
  });

  it("re-prompts when project bank id would be empty", async () => {
    const notify = vi.fn();
    const input = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("pi-coding");
    const resolved = await resolveSetupBankId({
      ctx: {
        ui: { notify, input, confirm: vi.fn() },
      } as never,
      client: {
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        getBankProfile: vi.fn(async () => ({ id: "pi-coding" })),
      },
      config: DEFAULT_CONFIG,
      kind: "project",
      title: "Coding bank ID",
      fallback: "",
    });
    expect(resolved).toEqual({ bankId: "pi-coding", state: "existing" });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Project bank ID is required"),
      "warning",
    );
    expect(input).toHaveBeenCalledTimes(2);
  });

  it("skips mental models and import when server probe ends offline", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-guided-offline-"));
    const notify = vi.fn();
    const applyBankTemplate = vi.fn();
    const listMentalModels = vi.fn();
    const confirm = vi
      .fn()
      // Decline API key env setup after failed probe
      .mockResolvedValueOnce(false)
      // Write config yes only (no MM / import prompts)
      .mockResolvedValueOnce(true);
    const ctx = {
      cwd,
      sessionManager: { getSessionFile: () => undefined },
      ui: {
        notify,
        input: vi.fn().mockResolvedValueOnce("project-bank"),
        select: vi
          .fn()
          // After key decline: Server still unreachable → offline
          .mockResolvedValueOnce("Continue offline (config only)")
          .mockResolvedValueOnce("Coding (shared coding bank + project tags)")
          .mockResolvedValueOnce("Coding (architecture, conventions, decisions)"),
        confirm,
      },
    } as never;

    const completed = await runGuidedSetup({
      ctx,
      cwd,
      deps: {
        getClient: () => ({
          retain: vi.fn(),
          recall: vi.fn(),
          reflect: vi.fn(),
          // No health → check falls through and fails without network mock
          getBankProfile: vi.fn(async () => {
            throw Object.assign(new Error("ECONNREFUSED"), { status: 503 });
          }),
          listMentalModels,
          importBankTemplate: applyBankTemplate,
        }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "project-bank",
      } as never,
    });

    expect(completed).toBe(true);
    expect(hasProjectHindsightConfig(cwd)).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Server: offline · project bank project-bank: unverified"),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Offline setup complete"), "info");
    expect(applyBankTemplate).not.toHaveBeenCalled();
    expect(listMentalModels).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]?.[0]).toBe("Write Pi Hindsight config?");
  });
});
