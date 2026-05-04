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
import {
  BUILT_IN_BANK_TEMPLATES,
  cloneBankTemplateManifest,
  defaultBankTemplateForTarget,
  getBuiltInBankTemplate,
  summarizeBankTemplateManifest,
  type BankTemplateManifest,
  type BankTemplateProfileId,
  type BankTemplateTarget,
} from "./bank-template-catalog.js";
import type { MemoryProfile, ProjectConfigPatchInput } from "./config-writer.js";
import type { SetupProfileChoice } from "./setup-tui-types.js";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";

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

interface TemplateTarget {
  label: string;
  location: "Project" | "User";
  bank: string;
  defaultTemplateTarget: BankTemplateTarget;
}

export function enabledTemplateTargets(args: {
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): TemplateTarget[] {
  return [
    ...(args.setupProfile !== "global-only" && args.projectBankId
      ? [
          {
            label: `Project bank (${args.projectBankId})`,
            location: "Project" as const,
            bank: args.projectBankId,
            defaultTemplateTarget: "project" as const,
          },
        ]
      : []),
    ...(args.setupProfile !== "project-only" && args.globalBankId
      ? [
          {
            label: `User bank (${args.globalBankId})`,
            location: "User" as const,
            bank: args.globalBankId,
            defaultTemplateTarget: "user" as const,
          },
        ]
      : []),
  ];
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const fields = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    fields.status === 404 ||
    fields.statusCode === 404 ||
    fields.code === 404 ||
    fields.code === "404" ||
    (typeof fields.message === "string" && /\b404\b|not found/i.test(fields.message))
  );
}

async function bankExists(
  client: HindsightLikeClient,
  bankId: string,
): Promise<boolean | undefined> {
  if (!client.getBankProfile) return undefined;
  try {
    await client.getBankProfile(bankId);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function chooseBuiltInTemplateOption(target: TemplateTarget): string {
  const fallback = defaultBankTemplateForTarget(target.defaultTemplateTarget).id;
  return BUILT_IN_BANK_TEMPLATES.find((template) => template.id === fallback)?.label ?? fallback;
}

function templateChoiceFromLabel(label: string): BankTemplateProfileId | undefined {
  return BUILT_IN_BANK_TEMPLATES.find((template) => template.label === label)?.id;
}

function bankTemplateReview(manifest: BankTemplateManifest): string {
  const summary = summarizeBankTemplateManifest(manifest);
  return [
    `Bank overrides: ${summary.bankOverrideCount}`,
    `Mental models: ${summary.mentalModelCount}`,
    `Directives: ${summary.directiveCount}`,
  ].join("\n");
}

async function selectTemplateManifest(args: {
  ctx: ExtensionCommandContext;
  target: TemplateTarget;
}): Promise<{ label: string; manifest: BankTemplateManifest } | undefined> {
  const defaultLabel = chooseBuiltInTemplateOption(args.target);
  const options = [
    "Skip",
    defaultLabel,
    ...BUILT_IN_BANK_TEMPLATES.map((template) => template.label).filter(
      (label) => label !== defaultLabel,
    ),
    "Paste JSON manifest",
  ];
  const choice = await args.ctx.ui.select(`Choose template for ${args.target.label}`, options);
  if (!choice || choice === "Skip") return undefined;
  if (choice === "Paste JSON manifest") {
    const rawManifest = await args.ctx.ui.input("Paste bank template JSON", '{"version":"1"}');
    if (rawManifest === undefined) return undefined;
    return { label: "Custom JSON", manifest: parseBankTemplateManifestJson(rawManifest) };
  }
  const templateId = templateChoiceFromLabel(choice);
  if (!templateId) return undefined;
  const template = getBuiltInBankTemplate(templateId);
  return { label: template.label, manifest: cloneBankTemplateManifest(template.manifest) };
}

async function maybeImportBankTemplate(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  operations: MemoryOperations;
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<void> {
  const targets = enabledTemplateTargets(args);
  if (targets.length === 0) {
    args.ctx.ui.notify("No enabled bank target for template import.", "warning");
    return;
  }
  const configure = await args.ctx.ui.confirm(
    "Configure Hindsight bank templates?",
    targets.map((target) => `${target.location}: ${target.bank}`).join("\n"),
  );
  if (!configure) return;

  const client = args.deps.getClient();
  for (const target of targets) {
    const selected = await selectTemplateManifest({ ctx: args.ctx, target });
    if (!selected) continue;

    const exists = await bankExists(client, target.bank);
    if (exists) {
      const updateExisting = await args.ctx.ui.confirm(
        `Bank already exists: ${target.bank}`,
        `Location: ${target.location}\nTemplate: ${selected.label}\n\nSetup preserves existing banks by default. Apply this template anyway?`,
      );
      if (!updateExisting) {
        args.ctx.ui.notify(`Skipped existing bank ${target.bank}.`, "info");
        continue;
      }
    } else if (exists === undefined) {
      const continueWithoutCheck = await args.ctx.ui.confirm(
        `Cannot check bank existence: ${target.bank}`,
        "Hindsight client does not expose bank lookup. Continue with template dry-run?",
      );
      if (!continueWithoutCheck) continue;
    }

    const reviewed = await args.ctx.ui.confirm(
      `Review template for ${target.label}`,
      `Template: ${selected.label}\n${bankTemplateReview(selected.manifest)}`,
    );
    if (!reviewed) continue;

    const dryRun = await args.operations.importBankTemplate({
      bank: target.bank,
      manifest: selected.manifest,
      dryRun: true,
    });
    const dryRunSummary = summarizeBankTemplateImportResult(dryRun.result);
    const confirmed = await args.ctx.ui.confirm(
      `Apply template to ${dryRun.bankId}?`,
      `Location: ${target.location}\nBank: ${dryRun.bankId}\nDry run result:\n${dryRunSummary}`,
    );
    if (!confirmed) continue;
    const applied = await args.operations.importBankTemplate({
      bank: target.bank,
      manifest: selected.manifest,
      dryRun: false,
    });
    args.ctx.ui.notify(
      `Imported ${selected.label} template into ${applied.bankId}: ${summarizeBankTemplateImportResult(applied.result)}`,
      "info",
    );
  }
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
    deps: args.deps,
    operations,
    setupProfile,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
  });
  return true;
}
