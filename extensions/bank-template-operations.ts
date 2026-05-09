import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveOperationBank } from "./bank-selection.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { isRecord } from "./client-rest.js";
import type { BankTemplateManifest } from "./bank-template-catalog.js";
import { validateBankTemplateManifestForEditing } from "./bank-template-editor.js";

export type { BankTemplateManifest } from "./bank-template-catalog.js";

export function parseBankTemplateManifestJson(input: string): BankTemplateManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid bank template JSON: ${message}`);
  }
  if (!isRecord(parsed)) throw new Error("Invalid bank template JSON: manifest must be an object.");
  if (parsed.version !== "1") throw new Error('Invalid bank template JSON: version must be "1".');
  const manifest = parsed as unknown as BankTemplateManifest;
  const errors = validateBankTemplateManifestForEditing(manifest);
  if (errors.length) throw new Error(`Invalid bank template JSON: ${errors.join(" ")}`);
  return manifest;
}

export function summarizeBankTemplateManifestValue(manifest: unknown): string {
  if (!isRecord(manifest)) return JSON.stringify(manifest, null, 2);
  const bank = isRecord(manifest.bank) ? manifest.bank : undefined;
  const mentalModels = Array.isArray(manifest.mental_models) ? manifest.mental_models : [];
  const directives = Array.isArray(manifest.directives) ? manifest.directives : [];
  return [
    `version: ${JSON.stringify(manifest.version ?? "unknown")}`,
    `bank_overrides: ${bank ? Object.keys(bank).length : 0}`,
    `mental_models: ${mentalModels.length}`,
    `directives: ${directives.length}`,
  ].join("\n");
}

export function summarizeBankTemplateImportResult(result: unknown): string {
  if (!isRecord(result)) return JSON.stringify(result, null, 2);
  const preferred = [
    "dry_run",
    "config_applied",
    "mental_models_created",
    "mental_models_updated",
    "directives_created",
    "directives_updated",
    "operation_ids",
  ];
  const lines = preferred
    .filter((key) => key in result)
    .map((key) => `${key}: ${JSON.stringify(result[key])}`);
  return lines.length ? lines.join("\n") : JSON.stringify(result, null, 2);
}

export function createBankTemplateOperations(deps: MemoryOperationsDeps) {
  return {
    async getBankTemplateSchema() {
      const client = deps.getClient();
      if (!client.getBankTemplateSchema) {
        throw new Error("Hindsight client does not support bank template schema fetch.");
      }
      const schema = await client.getBankTemplateSchema();
      return { schema };
    },

    async exportBankTemplate(args: { bank?: string; cwd?: string; outputFile?: string }) {
      const client = deps.getClient();
      if (!client.exportBankTemplate)
        throw new Error("Hindsight client does not support bank template export.");
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const manifest = await client.exportBankTemplate(bankId);
      if (!args.outputFile) return { bankId, manifest };
      const outputPath = resolve(args.cwd ?? process.cwd(), args.outputFile);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      return { bankId, manifest, outputPath };
    },

    async importBankTemplate(args: {
      bank?: string;
      manifest?: BankTemplateManifest;
      manifestJson?: string;
      sourceFile?: string;
      cwd?: string;
      dryRun?: boolean;
      confirmApply?: boolean;
    }) {
      const client = deps.getClient();
      if (!client.importBankTemplate)
        throw new Error("Hindsight client does not support bank template import.");
      const sourceCount = [args.manifest, args.manifestJson, args.sourceFile].filter(
        (value) => value !== undefined,
      ).length;
      if (sourceCount !== 1)
        throw new Error(
          "Provide exactly one bank template source: manifest, manifestJson, or sourceFile.",
        );
      const dryRun = args.dryRun ?? true;
      if (!dryRun && args.confirmApply !== true)
        throw new Error("confirmApply:true is required to apply a bank template import.");
      const manifest = args.manifest
        ? args.manifest
        : parseBankTemplateManifestJson(
            args.manifestJson ??
              (await readFile(resolve(args.cwd ?? process.cwd(), args.sourceFile!), "utf8")),
          );
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const result = await client.importBankTemplate(bankId, manifest, { dryRun });
      return { bankId, manifest, dryRun, sourceFile: args.sourceFile, result };
    },
  };
}
