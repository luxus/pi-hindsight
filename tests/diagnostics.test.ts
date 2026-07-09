import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  bankSelectionMessage,
  formatDebugReport,
  observationScopeDiagnostics,
  safeConfig,
} from "../extensions/utils/diagnostics.js";
import type { ImportManifestEntry } from "../extensions/imports/import-plan.js";
import {
  PI_HINDSIGHT_CLIENT_RANGE,
  PI_HINDSIGHT_SUPPORTED_NODE,
  PI_HINDSIGHT_SUPPORTED_NPM,
  PI_HINDSIGHT_SUPPORTED_TYPEBOX,
  PI_HINDSIGHT_USER_AGENT,
  PI_HINDSIGHT_VERSION,
} from "../extensions/version.js";

function latestImport(overrides: Partial<ImportManifestEntry> = {}): ImportManifestEntry {
  return {
    documentId: "doc-1",
    bankId: "bank",
    sourceFile: "/tmp/session.jsonl",
    importedAt: "2026-05-06T12:00:00.000Z",
    contentHash: "sha256:abc",
    messageCount: 3,
    leafId: "leaf-1",
    sessionId: "session-1",
    cwd: "/repo",
    includeBranches: "current-only",
    updateMode: "append",
    ...overrides,
  };
}

describe("diagnostics", () => {
  it("explains automatic bank selection and override", () => {
    expect(bankSelectionMessage("bank-1", DEFAULT_CONFIG)).toContain("auto-selected");
    expect(bankSelectionMessage("bank-1", DEFAULT_CONFIG)).toContain(
      "PI_HINDSIGHT_PROJECT_BANK_ID",
    );
  });

  it("explains configured bank selection", () => {
    const config = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        project: { ...DEFAULT_CONFIG.banks.project, bankId: "manual" },
      },
    };
    expect(bankSelectionMessage("manual", config)).toBe("Hindsight bank configured: manual");
  });

  it("redacts api key in debug config", () => {
    const config = {
      ...DEFAULT_CONFIG,
      hindsight: { ...DEFAULT_CONFIG.hindsight, apiKey: "secret", apiKeyRef: "env:KEY" },
    };
    expect(safeConfig(config).hindsight.apiKey).toBe("[set]");
    expect(safeConfig(config).hindsight.apiKeyRef).toBe("env:KEY");
  });

  it("formats stable debug report", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        sessionFile: "/tmp/session.jsonl",
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 2,
        health: { ok: true },
      }),
    ) as Record<string, unknown>;

    expect(report.projectBankId).toBe("bank");
    expect(report.health).toBe("reachable");
    expect(report.integration).toMatchObject({
      packageVersion: PI_HINDSIGHT_VERSION,
      userAgent: PI_HINDSIGHT_USER_AGENT,
      clientPackage: "@vectorize-io/hindsight-client",
      clientRange: PI_HINDSIGHT_CLIENT_RANGE,
      compatibility: {
        node: PI_HINDSIGHT_SUPPORTED_NODE,
        npm: PI_HINDSIGHT_SUPPORTED_NPM,
        typebox: PI_HINDSIGHT_SUPPORTED_TYPEBOX,
        hindsightServer:
          "Hindsight 0.8+ with append update_mode support; advanced tools are capability-gated.",
        policy: "Pi-first 1.0 integration; global platform admin parity is out of scope.",
      },
    });
    expect(report.queueLength).toBe(2);
    expect(report.queue).toEqual({
      path: DEFAULT_CONFIG.retain.queuePath,
      active: 2,
      malformedLines: 0,
      error: null,
      deadLetterPath: null,
      deadLetter: 0,
      deadLetterMalformedLines: 0,
      deadLetterError: null,
      action: null,
    });
    expect(report.serverRequirements).toMatchObject({
      appendUpdateMode: "required (Hindsight 0.8+)",
      action: "Upgrade to Hindsight 0.8+ if live append retain fails.",
    });
    expect(report.memoryProfile).toBe("project-only");
    expect(report.memoryRoutes).toEqual({ recall: ["project"], autoRetain: "project" });
    expect(report.bankMissions).toEqual({ projectConfigured: false, globalConfigured: false });
    const retain = report.retain as Record<string, any>;
    expect(retain.content.toolResult).toEqual(["error"]);
    expect(retain.toolFilter.toolResult.exclude).toContain("hindsight_recall");
    expect(report.observations).toEqual({
      enabled: true,
      scopes: [["harness:pi"], [expect.stringMatching(/^repo:/)]],
      error: null,
      action: null,
    });
    expect(report.overrideProjectBankId).toContain("PI_HINDSIGHT_PROJECT_BANK_ID");
    expect(report.tags).toEqual(expect.arrayContaining(["source:pi"]));
  });

  it("formats global-only memory routes", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "project-bank",
        config: {
          ...DEFAULT_CONFIG,
          banks: {
            project: { enabled: false, derive: "repo" },
            user: { enabled: true, bankId: "global-bank" },
            global: { enabled: true, bankId: "global-bank" },
          },
        },
        queueLength: 0,
      }),
    ) as Record<string, unknown>;

    expect(report.memoryProfile).toBe("global-only");
    expect(report.memoryRoutes).toEqual({ recall: ["global"], autoRetain: null });
  });

  it("formats disabled bank routes without calling them global-only", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "project-bank",
        config: {
          ...DEFAULT_CONFIG,
          banks: {
            project: { enabled: false, derive: "repo" },
            user: { enabled: false },
            global: { enabled: false },
          },
        },
        queueLength: 0,
      }),
    ) as Record<string, unknown>;

    expect(report.memoryProfile).toBe("none");
    expect(report.memoryRoutes).toEqual({ recall: [], autoRetain: null });
  });

  it("formats observation scope diagnostics", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: {
          ...DEFAULT_CONFIG,
          observations: { enabled: true, scopes: [["repo:{repoKey}"], ["bank:{projectBankId}"]] },
        },
        queueLength: 0,
      }),
    ) as Record<string, any>;

    expect(report.observations.enabled).toBe(true);
    expect(report.observations.scopes).toEqual([[expect.stringMatching(/^repo:/)], ["bank:bank"]]);
    expect(report.observations.error).toBeNull();
  });

  it("reports invalid observation scope diagnostics with action", () => {
    const result = observationScopeDiagnostics({
      cwd: process.cwd(),
      projectBankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        observations: { enabled: true, scopes: [["user:{userId}"]] },
      },
    });

    expect(result.scopes).toBeNull();
    expect(result.error).toContain("Unknown observation scope placeholder");
    expect(result.action).toContain("observations.scopes");
  });

  it("formats server floor diagnostics", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 0,
      }),
    ) as Record<string, unknown>;

    expect(report.serverRequirements).toMatchObject({
      appendUpdateMode: "required (Hindsight 0.8+)",
      clientPackage: "@vectorize-io/hindsight-client",
      action: "Upgrade to Hindsight 0.8+ if live append retain fails.",
    });
  });

  it("formats queue remediation when malformed lines or dead letters exist", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 1,
        queuePath: "/tmp/q.jsonl",
        queueMalformedLines: 2,
        deadLetterPath: "/tmp/q.jsonl.dead.jsonl",
        deadLetterLength: 3,
        deadLetterMalformedLines: 1,
      }),
    ) as Record<string, any>;

    expect(report.queue).toMatchObject({
      path: "/tmp/q.jsonl",
      active: 1,
      malformedLines: 2,
      deadLetterPath: "/tmp/q.jsonl.dead.jsonl",
      deadLetter: 3,
      deadLetterMalformedLines: 1,
    });
    expect(report.queue.action).toContain("Inspect queue files");
    expect(report.queue.action).toContain("/hindsight");
    expect(report.queue.action).toContain("press f");
    expect(report.queue.action).not.toContain("/hindsight:flush");
  });

  it("formats queue remediation when queue files cannot be read", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 0,
        queuePath: "/tmp/q.jsonl",
        queueReadError: "EACCES: permission denied",
        deadLetterPath: "/tmp/q.jsonl.dead.jsonl",
        deadLetterLength: 0,
        deadLetterReadError: "ENOTDIR: not a directory",
      }),
    ) as Record<string, any>;

    expect(report.queue).toMatchObject({
      path: "/tmp/q.jsonl",
      active: 0,
      error: "EACCES: permission denied",
      deadLetterPath: "/tmp/q.jsonl.dead.jsonl",
      deadLetter: 0,
      deadLetterError: "ENOTDIR: not a directory",
    });
    expect(report.queue.action).toContain("Inspect queue files");
  });

  it("formats queue remediation when only dead-letter malformed lines exist", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 0,
        deadLetterLength: 0,
        deadLetterMalformedLines: 1,
      }),
    ) as Record<string, any>;

    expect(report.queue.deadLetterMalformedLines).toBe(1);
    expect(report.queue.action).toContain("Inspect queue files");
  });

  it("includes latest import quality context when manifest fields are present", () => {
    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 0,
        latestImport: latestImport({
          importMode: "curated",
          toolResults: "summary",
          importQualityProfile: "strict",
          projectionVersion: "curated-turns-v1",
          importProfile: "turns-12-bytes-80000",
          chunkIndex: 0,
          messageRange: { start: 4, end: 8 },
          updateMode: "replace",
        }),
      }),
    ) as Record<string, any>;

    expect(report.imports.latest).toEqual({
      documentId: "doc-1",
      sourceFile: "/tmp/session.jsonl",
      importedAt: "2026-05-06T12:00:00.000Z",
      messageCount: 3,
      leafId: "leaf-1",
      sessionId: "session-1",
      contentHash: "sha256:abc",
      importMode: "curated",
      toolResults: "summary",
      importQualityProfile: "strict",
      projectionVersion: "curated-turns-v1",
      importProfile: "turns-12-bytes-80000",
      chunkIndex: 0,
      messageRange: { start: 4, end: 8 },
      updateMode: "replace",
    });
  });

  it("omits absent latest import quality fields", () => {
    const importWithoutQualityContext = latestImport() as Partial<ImportManifestEntry>;
    delete importWithoutQualityContext.updateMode;

    const report = JSON.parse(
      formatDebugReport({
        cwd: process.cwd(),
        projectBankId: "bank",
        config: DEFAULT_CONFIG,
        queueLength: 0,
        latestImport: importWithoutQualityContext as ImportManifestEntry,
      }),
    ) as Record<string, any>;

    expect(report.imports.latest).toEqual({
      documentId: "doc-1",
      sourceFile: "/tmp/session.jsonl",
      importedAt: "2026-05-06T12:00:00.000Z",
      messageCount: 3,
      leafId: "leaf-1",
      sessionId: "session-1",
      contentHash: "sha256:abc",
    });
  });
});
