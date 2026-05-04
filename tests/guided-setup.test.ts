import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config-defaults.js";
import {
  buildGuidedSetupPatch,
  editTemplateManifestForSetup,
  enabledTemplateTargets,
  hasProjectHindsightConfig,
  importChoicesForSetup,
  maybeOfferHistoricalImportForSetup,
  setupProfileChoiceToMemoryProfile,
} from "../extensions/guided-setup.js";

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
    expect(setupProfileChoiceToMemoryProfile("project-only")).toBe("project-only");
    expect(setupProfileChoiceToMemoryProfile("project-global")).toBe("project+global");
    expect(setupProfileChoiceToMemoryProfile("global-only")).toBe("global-only");
  });

  it("builds profile and bank patches without inventing global bank IDs", () => {
    expect(
      buildGuidedSetupPatch({
        profile: "project-only",
        projectBankId: "project-bank",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({ memoryProfile: "project-only", projectBankId: "project-bank" });

    expect(
      buildGuidedSetupPatch({
        profile: "project-global",
        projectBankId: "project-bank",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({
      memoryProfile: "project+global",
      projectBankId: "project-bank",
      globalBankId: "global-luxus",
    });

    expect(
      buildGuidedSetupPatch({
        profile: "global-only",
        projectBankId: "ignored-project",
        globalBankId: "global-luxus",
        config: DEFAULT_CONFIG,
      }),
    ).toEqual({ memoryProfile: "global-only", globalBankId: "global-luxus" });
  });

  it("builds template targets with concrete project and user bank locations", () => {
    expect(
      enabledTemplateTargets({
        setupProfile: "project-global",
        projectBankId: "project-bank",
        globalBankId: "global-luxus",
      }),
    ).toEqual([
      {
        label: "Project bank (project-bank)",
        location: "Project",
        bank: "project-bank",
        defaultTemplateTarget: "project",
      },
      {
        label: "User bank (global-luxus)",
        location: "User",
        bank: "global-luxus",
        defaultTemplateTarget: "user",
      },
    ]);
  });

  it("edits a selected template before setup apply", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Edit bank field")
      .mockResolvedValueOnce("Retain extraction mode: concise")
      .mockResolvedValueOnce("verbose")
      .mockResolvedValueOnce("Use template");
    const ctx = {
      ui: {
        select,
        input: vi.fn(),
      },
    } as never;

    const result = await editTemplateManifestForSetup({
      ctx,
      label: "Coding Project",
      manifest: {
        version: "1",
        bank: { retain_extraction_mode: "concise" },
      },
    });

    expect(result?.bank?.retain_extraction_mode).toBe("verbose");
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("Review or edit bank template\nTemplate: Coding Project"),
      ["Use template", "Edit bank field", "Cancel"],
    );
  });

  it("edits mental model fields before setup apply", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Edit bank field")
      .mockResolvedValueOnce("Mental model Project Context max tokens: 1024")
      .mockResolvedValueOnce("Use template");
    const input = vi.fn().mockResolvedValueOnce("2048");
    const ctx = {
      ui: {
        select,
        input,
        notify: vi.fn(),
      },
    } as never;

    const result = await editTemplateManifestForSetup({
      ctx,
      label: "Coding Project",
      manifest: {
        version: "1",
        mental_models: [
          {
            id: "project-context",
            name: "Project Context",
            source_query: "What matters?",
            max_tokens: 1024,
          },
        ],
      },
    });

    expect(result?.mental_models?.[0]?.max_tokens).toBe(2048);
  });

  it("recovers from invalid setup editor field values", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Edit bank field")
      .mockResolvedValueOnce("Disposition empathy (advanced)")
      .mockResolvedValueOnce("Use template");
    const notify = vi.fn();
    const ctx = {
      ui: {
        select,
        input: vi.fn().mockResolvedValueOnce("9"),
        notify,
      },
    } as never;

    const result = await editTemplateManifestForSetup({
      ctx,
      label: "Coding Project",
      manifest: { version: "1", bank: {} },
    });

    expect(result?.bank).toEqual({});
    expect(notify).toHaveBeenCalledWith(
      "Disposition empathy must be an integer from 1 to 5.",
      "warning",
    );
  });

  it("requires template validation errors to be fixed before use", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Edit bank field")
      .mockResolvedValueOnce("Retain mission")
      .mockResolvedValueOnce("Cancel");
    const input = vi.fn().mockResolvedValueOnce("Remember useful facts.");
    const ctx = {
      ui: {
        select,
        input,
      },
    } as never;

    const result = await editTemplateManifestForSetup({
      ctx,
      label: "Bad Template",
      manifest: {
        version: "1",
        mental_models: [{ id: "Bad ID", name: "", source_query: "" }],
      },
    });

    expect(result).toBeUndefined();
    expect(select).toHaveBeenNthCalledWith(1, expect.stringContaining("Validation errors:"), [
      "Edit bank field",
      "Cancel",
    ]);
  });

  it("limits setup import choices to configured setup banks", () => {
    expect(
      importChoicesForSetup({
        setupProfile: "global-only",
        appliedProfiles: new Set(["coding-project"]),
        globalBankId: "user-bank",
      }),
    ).toEqual(["Skip import", "Preview gateway transcript"]);
    expect(
      importChoicesForSetup({
        setupProfile: "project-only",
        appliedProfiles: new Set(["assistant-personal"]),
        projectBankId: "project-bank",
      }),
    ).toEqual(["Skip import", "Preview repo Pi sessions"]);
    expect(
      importChoicesForSetup({
        setupProfile: "project-global",
        appliedProfiles: new Set(["assistant-personal"]),
        projectBankId: "project-bank",
        globalBankId: "user-bank",
      }),
    ).toEqual(["Skip import", "Preview gateway transcript", "Preview repo Pi sessions"]);
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
      importGatewayTranscript: vi.fn(),
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
    });
    expect(importProjectSessions).toHaveBeenCalledTimes(1);
  });

  it("previews gateway import after user setup before writing", async () => {
    const ctx = {
      ui: {
        confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        select: vi.fn().mockResolvedValueOnce("Preview gateway transcript"),
        input: vi.fn().mockResolvedValueOnce("/tmp/gateway.jsonl"),
        notify: vi.fn(),
      },
    } as never;
    const importGatewayTranscript = vi.fn().mockResolvedValueOnce({
      bankId: "user-bank",
      keptEventCount: 3,
      retainedTurnCount: 1,
      droppedEventCount: 2,
      malformedLineCount: 0,
      documentId: "doc",
    });
    const operations = {
      importProjectSessions: vi.fn(),
      importGatewayTranscript,
    } as never;

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations,
      setupProfile: "global-only",
      appliedTemplates: [
        {
          bank: "user-bank",
          location: "User",
          label: "Assistant / Personal",
          profileId: "assistant-personal",
          mentalModels: [],
        },
      ],
      cwd: "/repo",
      globalBankId: "user-bank",
    });

    expect(importGatewayTranscript).toHaveBeenCalledWith({
      sourceFile: "/tmp/gateway.jsonl",
      cwd: "/repo",
      bank: "user-bank",
      dryRun: true,
    });
    expect(importGatewayTranscript).toHaveBeenCalledTimes(1);
  });

  it("offers mental model refresh after successful setup import", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const notify = vi.fn();
    const ctx = {
      ui: {
        confirm,
        select: vi.fn().mockResolvedValueOnce("Preview gateway transcript"),
        input: vi.fn().mockResolvedValueOnce("/tmp/gateway.jsonl"),
        notify,
      },
    } as never;
    const importGatewayTranscript = vi
      .fn()
      .mockResolvedValueOnce({
        bankId: "user-bank",
        keptEventCount: 3,
        retainedTurnCount: 1,
        droppedEventCount: 2,
        malformedLineCount: 0,
        documentId: "doc",
      })
      .mockResolvedValueOnce({
        bankId: "user-bank",
        skipped: false,
        documentId: "doc",
      });
    const refreshMentalModel = vi.fn().mockResolvedValueOnce({
      bankId: "user-bank",
      mentalModelId: "user-profile",
      result: { operation_id: "op-123", status: "queued" },
    });
    const operations = {
      importProjectSessions: vi.fn(),
      importGatewayTranscript,
      refreshMentalModel,
    } as never;

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations,
      setupProfile: "global-only",
      appliedTemplates: [
        {
          bank: "user-bank",
          location: "User",
          label: "Assistant / Personal",
          profileId: "assistant-personal",
          mentalModels: [
            {
              id: "user-profile",
              name: "User Profile",
              source_query: "What do we know?",
              tags: ["profile"],
            },
          ],
        },
      ],
      cwd: "/repo",
      globalBankId: "user-bank",
    });

    expect(refreshMentalModel).toHaveBeenCalledWith({
      bank: "user-bank",
      mentalModelId: "user-profile",
    });
    expect(confirm).toHaveBeenNthCalledWith(
      3,
      "Refresh 1 mental model for User bank user-bank?",
      expect.stringContaining(
        "User Profile uses tags [profile]; refresh only sees matching memories.",
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      "Queued mental model refresh:\nUser Profile: op-123 / queued",
      "info",
    );
  });

  it("skips mental model refresh when user declines", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const ctx = {
      ui: {
        confirm,
        select: vi.fn().mockResolvedValueOnce("Preview gateway transcript"),
        input: vi.fn().mockResolvedValueOnce("/tmp/gateway.jsonl"),
        notify: vi.fn(),
      },
    } as never;
    const importGatewayTranscript = vi
      .fn()
      .mockResolvedValueOnce({
        bankId: "user-bank",
        keptEventCount: 1,
        retainedTurnCount: 1,
        droppedEventCount: 0,
        malformedLineCount: 0,
        documentId: "doc",
      })
      .mockResolvedValueOnce({ bankId: "user-bank", skipped: false, documentId: "doc" });
    const refreshMentalModel = vi.fn();

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations: {
        importProjectSessions: vi.fn(),
        importGatewayTranscript,
        refreshMentalModel,
      } as never,
      setupProfile: "global-only",
      appliedTemplates: [
        {
          bank: "user-bank",
          location: "User",
          label: "Assistant / Personal",
          profileId: "assistant-personal",
          mentalModels: [{ id: "user-profile", name: "User Profile", source_query: "q" }],
        },
      ],
      cwd: "/repo",
      globalBankId: "user-bank",
    });

    expect(refreshMentalModel).not.toHaveBeenCalled();
  });

  it("continues mental model refresh when one model fails", async () => {
    const notify = vi.fn();
    const ctx = {
      ui: {
        confirm: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
        select: vi.fn().mockResolvedValueOnce("Preview gateway transcript"),
        input: vi.fn().mockResolvedValueOnce("/tmp/gateway.jsonl"),
        notify,
      },
    } as never;
    const refreshMentalModel = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce({ result: { operation_id: "op-2", status: "queued" } });

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations: {
        importProjectSessions: vi.fn(),
        importGatewayTranscript: vi
          .fn()
          .mockResolvedValueOnce({
            bankId: "user-bank",
            keptEventCount: 2,
            retainedTurnCount: 1,
            droppedEventCount: 0,
            malformedLineCount: 0,
            documentId: "doc",
          })
          .mockResolvedValueOnce({ bankId: "user-bank", skipped: false, documentId: "doc" }),
        refreshMentalModel,
      } as never,
      setupProfile: "global-only",
      appliedTemplates: [
        {
          bank: "user-bank",
          location: "User",
          label: "Assistant / Personal",
          profileId: "assistant-personal",
          mentalModels: [
            { id: "first", name: "First", source_query: "q" },
            { id: "second", name: "Second", source_query: "q" },
          ],
        },
      ],
      cwd: "/repo",
      globalBankId: "user-bank",
    });

    expect(refreshMentalModel).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      "Queued mental model refresh:\nSecond: op-2 / queued",
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      "Mental model refresh failed:\nFirst: refresh failed",
      "warning",
    );
  });

  it("refreshes only mental models for the imported setup location", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const ctx = {
      sessionManager: { getSessionFile: () => "/sessions/current.jsonl" },
      ui: {
        confirm,
        select: vi.fn().mockResolvedValueOnce("Preview repo Pi sessions"),
        input: vi.fn(),
        notify: vi.fn(),
      },
    } as never;
    const importProjectSessions = vi
      .fn()
      .mockResolvedValueOnce({
        bankId: "shared-bank",
        sessionFiles: ["/sessions/current.jsonl"],
        imported: [{ documents: [] }],
        malformedLineCount: 0,
        documentCount: 1,
        messageCount: 2,
      })
      .mockResolvedValueOnce({
        bankId: "shared-bank",
        sessionFiles: ["/sessions/current.jsonl"],
        documentCount: 1,
        messageCount: 2,
      });
    const refreshMentalModel = vi.fn().mockResolvedValue({
      bankId: "shared-bank",
      result: { operation_id: "op-project" },
    });
    const operations = {
      importProjectSessions,
      importGatewayTranscript: vi.fn(),
      refreshMentalModel,
    } as never;

    await maybeOfferHistoricalImportForSetup({
      ctx,
      operations,
      setupProfile: "project-global",
      appliedTemplates: [
        {
          bank: "shared-bank",
          location: "Project",
          label: "Coding / Project",
          profileId: "coding-project",
          mentalModels: [{ id: "project-context", name: "Project Context", source_query: "q" }],
        },
        {
          bank: "shared-bank",
          location: "User",
          label: "Assistant / Personal",
          profileId: "assistant-personal",
          mentalModels: [{ id: "user-profile", name: "User Profile", source_query: "q" }],
        },
      ],
      cwd: "/repo",
      projectBankId: "shared-bank",
      globalBankId: "shared-bank",
    });

    expect(refreshMentalModel).toHaveBeenCalledTimes(1);
    expect(refreshMentalModel).toHaveBeenCalledWith({
      bank: "shared-bank",
      mentalModelId: "project-context",
    });
  });

  it("uses existing configured global bank ID when profile enables global memory", () => {
    expect(
      buildGuidedSetupPatch({
        profile: "project-global",
        projectBankId: "project-bank",
        config: configuredGlobal,
      }),
    ).toEqual({
      memoryProfile: "project+global",
      projectBankId: "project-bank",
      globalBankId: "global-luxus",
    });
  });
});
