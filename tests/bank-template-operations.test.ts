import { describe, expect, it, vi } from "vitest";
import {
  createBankTemplateOperations,
  parseBankTemplateManifestJson,
  summarizeBankTemplateImportResult,
} from "../extensions/bank-template-operations.js";
import { DEFAULT_CONFIG } from "../extensions/config-defaults.js";
import type { MemoryOperationsDeps } from "../extensions/memory-operation-types.js";

function deps() {
  const importBankTemplate = vi.fn(async () => ({ dry_run: true, config_applied: true }));
  const config = {
    ...DEFAULT_CONFIG,
    banks: {
      ...DEFAULT_CONFIG.banks,
      global: { ...DEFAULT_CONFIG.banks.global, enabled: true, bankId: "global-luxus" },
    },
  };
  return {
    importBankTemplate,
    deps: {
      getClient: () => ({
        retain: vi.fn(),
        recall: vi.fn(),
        reflect: vi.fn(),
        importBankTemplate,
      }),
      getConfig: () => config,
      getProjectBankId: () => "project-bank",
    } satisfies MemoryOperationsDeps,
  };
}

describe("bank template operations", () => {
  it("strictly parses manifest JSON objects", () => {
    expect(parseBankTemplateManifestJson('{"version":"1"}')).toEqual({ version: "1" });
    expect(() => parseBankTemplateManifestJson("not json")).toThrow("Invalid bank template JSON");
    expect(() => parseBankTemplateManifestJson("[]")).toThrow("manifest must be an object");
    expect(() => parseBankTemplateManifestJson("{}")).toThrow('version must be "1"');
  });

  it("resolves bank aliases before dry-run import", async () => {
    const fixture = deps();
    const result = await createBankTemplateOperations(fixture.deps).importBankTemplate({
      bank: "global",
      manifest: { version: "1" },
      dryRun: true,
    });

    expect(result).toEqual({
      bankId: "global-luxus",
      result: { dry_run: true, config_applied: true },
    });
    expect(fixture.importBankTemplate).toHaveBeenCalledWith(
      "global-luxus",
      { version: "1" },
      { dryRun: true },
    );
  });

  it("formats dry-run summaries", () => {
    expect(
      summarizeBankTemplateImportResult({
        dry_run: true,
        config_applied: true,
        mental_models_created: 2,
        directives_created: 1,
      }),
    ).toContain("mental_models_created: 2");
    expect(summarizeBankTemplateImportResult("ok")).toBe('"ok"');
  });
});
