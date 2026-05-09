import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createBankTemplateOperations,
  parseBankTemplateManifestJson,
  summarizeBankTemplateImportResult,
  summarizeBankTemplateManifestValue,
} from "../extensions/bank-template-operations.js";
import { DEFAULT_CONFIG } from "../extensions/config-defaults.js";
import type { MemoryOperationsDeps } from "../extensions/memory-operation-types.js";

function deps() {
  const importBankTemplate = vi.fn(async () => ({ dry_run: true, config_applied: true }));
  const exportBankTemplate = vi.fn(async () => ({
    version: "1" as const,
    bank: { retain_mission: "Remember useful facts" },
    mental_models: [{ id: "profile", name: "Profile", source_query: "What matters?" }],
  }));
  const config = {
    ...DEFAULT_CONFIG,
    banks: {
      ...DEFAULT_CONFIG.banks,
      user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-luxus" },
    },
  };
  return {
    importBankTemplate,
    exportBankTemplate,
    deps: {
      getClient: () => ({
        retain: vi.fn(),
        recall: vi.fn(),
        reflect: vi.fn(),
        importBankTemplate,
        exportBankTemplate,
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
    expect(() =>
      parseBankTemplateManifestJson(
        JSON.stringify({
          version: "1",
          mental_models: [
            { id: "dup", name: "A", source_query: "Q" },
            { id: "dup", name: "B", source_query: "Q" },
          ],
        }),
      ),
    ).toThrow("Duplicate mental model id: dup");
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
      manifest: { version: "1" },
      dryRun: true,
      sourceFile: undefined,
      result: { dry_run: true, config_applied: true },
    });
    expect(fixture.importBankTemplate).toHaveBeenCalledWith(
      "global-luxus",
      { version: "1" },
      { dryRun: true },
    );
  });

  it("loads manifest files and requires confirmation before apply", async () => {
    const fixture = deps();
    const operations = createBankTemplateOperations(fixture.deps);
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-template-import-"));
    await writeFile(join(cwd, "template.json"), '{"version":"1","bank":{"retain_mission":"x"}}');

    await expect(
      operations.importBankTemplate({ sourceFile: "template.json", cwd, dryRun: false }),
    ).rejects.toThrow("confirmApply:true is required");

    await expect(
      operations.importBankTemplate({
        sourceFile: "template.json",
        cwd,
        dryRun: false,
        confirmApply: true,
      }),
    ).resolves.toMatchObject({
      bankId: "project-bank",
      manifest: { version: "1", bank: { retain_mission: "x" } },
      dryRun: false,
      sourceFile: "template.json",
    });
    expect(fixture.importBankTemplate).toHaveBeenLastCalledWith(
      "project-bank",
      { version: "1", bank: { retain_mission: "x" } },
      { dryRun: false },
    );
  });

  it("requires exactly one manifest source", async () => {
    const fixture = deps();
    const operations = createBankTemplateOperations(fixture.deps);

    await expect(operations.importBankTemplate({ dryRun: true })).rejects.toThrow(
      "Provide exactly one bank template source",
    );
    await expect(
      operations.importBankTemplate({
        manifest: { version: "1" },
        manifestJson: '{"version":"1"}',
      }),
    ).rejects.toThrow("Provide exactly one bank template source");
  });

  it("exports bank templates through resolved bank aliases", async () => {
    const fixture = deps();
    const operations = createBankTemplateOperations(fixture.deps);

    await expect(operations.exportBankTemplate({ bank: "global" })).resolves.toEqual({
      bankId: "global-luxus",
      manifest: {
        version: "1",
        bank: { retain_mission: "Remember useful facts" },
        mental_models: [{ id: "profile", name: "Profile", source_query: "What matters?" }],
      },
    });
    expect(fixture.exportBankTemplate).toHaveBeenCalledWith("global-luxus");
  });

  it("saves exported bank templates as pretty JSON", async () => {
    const fixture = deps();
    const operations = createBankTemplateOperations(fixture.deps);
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-template-export-"));

    const result = await operations.exportBankTemplate({
      bank: "global",
      cwd,
      outputFile: "exports/template.json",
    });

    expect(result.outputPath).toBe(join(cwd, "exports/template.json"));
    await expect(readFile(join(cwd, "exports/template.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(result.manifest, null, 2)}\n`,
    );
  });

  it("formats dry-run and manifest summaries", () => {
    expect(
      summarizeBankTemplateImportResult({
        dry_run: true,
        config_applied: true,
        mental_models_created: 2,
        directives_created: 1,
      }),
    ).toContain("mental_models_created: 2");
    expect(summarizeBankTemplateImportResult("ok")).toBe('"ok"');
    expect(
      summarizeBankTemplateManifestValue({
        version: "1",
        bank: { retain_mission: "Retain" },
        mental_models: [{}],
        directives: [{ name: "Rule" }],
      }),
    ).toContain("mental_models: 1");
  });
});
