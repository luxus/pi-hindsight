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
  setupProfileChoiceToMemoryProfile,
} from "../extensions/guided-setup.js";

const configuredGlobal = {
  ...DEFAULT_CONFIG,
  banks: {
    ...DEFAULT_CONFIG.banks,
    global: { ...DEFAULT_CONFIG.banks.global, bankId: "global-luxus" },
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
