import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  parseBankTemplateManifestJson,
  summarizeBankTemplateImportResult,
} from "./bank-template-operations.js";
import {
  createMemoryOperations,
  type MemoryOperations,
  type MemoryOperationsDeps,
} from "./memory-operation-service.js";
import type { MemoryProfile, ProjectConfigPatchInput } from "./config-writer.js";
import type { SetupProfileChoice } from "./setup-tui-types.js";
import type { ResolvedConfig } from "./types.js";

export function hasProjectHindsightConfig(cwd: string): boolean {
  return (
    existsSync(join(cwd, ".pi", "hindsight.json")) ||
    existsSync(join(cwd, ".pi", "hindsight.jsonc"))
  );
}

export function setupProfileChoiceToMemoryProfile(choice: SetupProfileChoice): MemoryProfile {
  return choice === "project-global" ? "project+global" : choice;
}

export function buildGuidedSetupPatch(args: {
  profile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
  config: ResolvedConfig;
}): ProjectConfigPatchInput {
  const memoryProfile = setupProfileChoiceToMemoryProfile(args.profile);
  return {
    memoryProfile,
    ...(memoryProfile !== "global-only" && args.projectBankId?.trim()
      ? { projectBankId: args.projectBankId.trim() }
      : {}),
    ...(memoryProfile !== "project-only" && args.globalBankId?.trim()
      ? { globalBankId: args.globalBankId.trim() }
      : args.config.banks.global.bankId && memoryProfile !== "project-only"
        ? { globalBankId: args.config.banks.global.bankId }
        : {}),
  };
}

async function askBankId(args: {
  ctx: ExtensionCommandContext;
  title: string;
  fallback: string;
}): Promise<string | undefined> {
  const value = await args.ctx.ui.input(args.title, args.fallback);
  if (value === undefined) return undefined;
  return value.trim() || args.fallback;
}

function enabledTemplateTargets(args: {
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): Array<{ label: string; bank: string }> {
  return [
    ...(args.setupProfile !== "global-only" && args.projectBankId
      ? [{ label: `project (${args.projectBankId})`, bank: args.projectBankId }]
      : []),
    ...(args.setupProfile !== "project-only" && args.globalBankId
      ? [{ label: `global (${args.globalBankId})`, bank: args.globalBankId }]
      : []),
  ];
}

async function maybeImportBankTemplate(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<void> {
  const choice = await args.ctx.ui.select("Import Hindsight bank template JSON?", [
    "Skip",
    "Paste JSON manifest",
  ]);
  if (choice !== "Paste JSON manifest") return;

  const targets = enabledTemplateTargets(args);
  if (targets.length === 0) {
    args.ctx.ui.notify("No enabled bank target for template import.", "warning");
    return;
  }
  const targetLabel =
    targets.length === 1
      ? targets[0]!.label
      : await args.ctx.ui.select(
          "Choose template import target bank",
          targets.map((target) => target.label),
        );
  if (!targetLabel) return;
  const target = targets.find((candidate) => candidate.label === targetLabel);
  if (!target) return;

  const rawManifest = await args.ctx.ui.input("Paste bank template JSON", '{"version":"1"}');
  if (rawManifest === undefined) return;
  const manifest = parseBankTemplateManifestJson(rawManifest);
  const dryRun = await args.operations.importBankTemplate({
    bank: target.bank,
    manifest,
    dryRun: true,
  });
  const dryRunSummary = summarizeBankTemplateImportResult(dryRun.result);
  const confirmed = await args.ctx.ui.confirm(
    `Apply template to ${dryRun.bankId}?`,
    `Dry run result:\n${dryRunSummary}`,
  );
  if (!confirmed) return;
  const applied = await args.operations.importBankTemplate({
    bank: target.bank,
    manifest,
    dryRun: false,
  });
  args.ctx.ui.notify(
    `Imported bank template into ${applied.bankId}: ${summarizeBankTemplateImportResult(applied.result)}`,
    "info",
  );
}

export async function runGuidedSetup(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  cwd: string;
}): Promise<boolean> {
  const profile = await args.ctx.ui.select("Choose memory profile", [
    "project-only",
    "project+global",
    "global-only",
  ]);
  if (!profile) return false;

  const setupProfile = (
    profile === "project+global" ? "project-global" : profile
  ) as SetupProfileChoice;
  const config = args.deps.getConfig();
  const projectBankId =
    setupProfile === "global-only"
      ? undefined
      : await askBankId({
          ctx: args.ctx,
          title: "Project bank ID",
          fallback: config.banks.project.bankId ?? args.deps.getProjectBankId(),
        });
  if (setupProfile !== "global-only" && projectBankId === undefined) return false;

  const globalBankId =
    setupProfile === "project-only"
      ? undefined
      : await askBankId({
          ctx: args.ctx,
          title: "Global bank ID",
          fallback: config.banks.global.bankId ?? "",
        });
  if (setupProfile !== "project-only" && !globalBankId) {
    args.ctx.ui.notify("Global bank ID required for global memory profiles.", "warning");
    return false;
  }

  const patch = buildGuidedSetupPatch({
    profile: setupProfile,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
    config,
  });
  const summary = [
    `Profile: ${setupProfileChoiceToMemoryProfile(setupProfile)}`,
    ...(projectBankId ? [`Project bank: ${projectBankId}`] : []),
    ...(globalBankId ? [`Global bank: ${globalBankId}`] : []),
  ].join("\n");
  const confirmed = await args.ctx.ui.confirm("Write Pi Hindsight config?", summary);
  if (!confirmed) return false;

  const operations = createMemoryOperations(args.deps);
  const result = await operations.configure(args.cwd, patch);
  args.ctx.ui.notify(`Wrote ${result.path}`, "info");

  await maybeImportBankTemplate({
    ctx: args.ctx,
    operations,
    setupProfile,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
  });
  return true;
}
