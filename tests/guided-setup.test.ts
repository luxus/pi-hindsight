import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config-defaults.js";
import {
  buildGuidedSetupGlobalPatch,
  buildGuidedSetupPatch,
  hasProjectHindsightConfig,
  importChoicesForSetup,
  maybeOfferHistoricalImportForSetup,
  runGuidedSetup,
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
      projectBankId: "project-bank",
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
});
