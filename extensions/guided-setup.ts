import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  parseBankTemplateManifestJson,
  summarizeBankTemplateImportResult,
} from "./bank-template-operations.js";
import {
  buildBankTemplateEditorFields,
  mentalModelTagWarnings,
  updateBankTemplateField,
  validateBankTemplateManifestForEditing,
  type BankTemplateEditorField,
} from "./bank-template-editor.js";
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
  type BankTemplateMentalModel,
  type BankTemplateProfileId,
  type BankTemplateTarget,
} from "./bank-template-catalog.js";
import { importDocumentSummary } from "./import-presentation.js";
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
      : args.config.banks.user.bankId && memoryProfile !== "project-only"
        ? { globalBankId: args.config.banks.user.bankId }
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

interface AppliedTemplateTarget {
  bank: string;
  location: "Project" | "User";
  label: string;
  profileId?: BankTemplateProfileId;
  mentalModels: BankTemplateMentalModel[];
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
  const warnings = mentalModelTagWarnings(manifest);
  return [
    `Bank overrides: ${summary.bankOverrideCount}`,
    `Mental models: ${summary.mentalModelCount}`,
    `Directives: ${summary.directiveCount}`,
    ...(warnings.length ? ["Warnings:", ...warnings.map((warning) => `- ${warning}`)] : []),
  ].join("\n");
}

function templateFieldOption(field: BankTemplateEditorField): string {
  const advanced = field.advanced ? " (advanced)" : "";
  const value = field.value ? `: ${field.value}` : "";
  return `${field.label}${advanced}${value}`;
}

function fieldFromOption(
  fields: BankTemplateEditorField[],
  option: string,
): BankTemplateEditorField | undefined {
  return fields.find((field) => templateFieldOption(field) === option);
}

function editedValueFallback(field: BankTemplateEditorField): string {
  if (field.kind === "boolean" && field.value !== "true" && field.value !== "false") return "false";
  return field.value;
}

export async function editTemplateManifestForSetup(args: {
  ctx: ExtensionCommandContext;
  label: string;
  manifest: BankTemplateManifest;
}): Promise<BankTemplateManifest | undefined> {
  let manifest = cloneBankTemplateManifest(args.manifest);
  while (true) {
    const errors = validateBankTemplateManifestForEditing(manifest);
    const body = [
      `Template: ${args.label}`,
      bankTemplateReview(manifest),
      ...(errors.length ? ["", "Validation errors:", ...errors.map((error) => `- ${error}`)] : []),
    ].join("\n");
    const action = await args.ctx.ui.select(`Review or edit bank template\n${body}`, [
      ...(errors.length === 0 ? ["Use template"] : []),
      "Edit bank field",
      "Cancel",
    ]);
    if (!action || action === "Cancel") return undefined;
    if (action === "Use template") return manifest;

    const fields = buildBankTemplateEditorFields(manifest);
    const fieldOption = await args.ctx.ui.select(body, fields.map(templateFieldOption));
    if (!fieldOption) continue;
    const field = fieldFromOption(fields, fieldOption);
    if (!field) continue;
    const value = field.choices
      ? await args.ctx.ui.select(`Set ${field.label}`, field.choices)
      : await args.ctx.ui.input(`Set ${field.label}`, editedValueFallback(field));
    if (value === undefined) continue;
    try {
      manifest = updateBankTemplateField(manifest, field.id, value);
    } catch (error) {
      args.ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  }
}

async function selectTemplateManifest(args: {
  ctx: ExtensionCommandContext;
  target: TemplateTarget;
}): Promise<
  { label: string; manifest: BankTemplateManifest; profileId?: BankTemplateProfileId } | undefined
> {
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
  return {
    label: template.label,
    manifest: cloneBankTemplateManifest(template.manifest),
    profileId: template.id,
  };
}

async function maybeImportBankTemplate(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  operations: MemoryOperations;
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<AppliedTemplateTarget[]> {
  const targets = enabledTemplateTargets(args);
  if (targets.length === 0) {
    args.ctx.ui.notify("No enabled bank target for template import.", "warning");
    return [];
  }
  const configure = await args.ctx.ui.confirm(
    "Configure Hindsight bank templates?",
    targets.map((target) => `${target.location}: ${target.bank}`).join("\n"),
  );
  if (!configure) return [];

  const appliedTemplates: AppliedTemplateTarget[] = [];
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

    const editedManifest = await editTemplateManifestForSetup({
      ctx: args.ctx,
      label: `${selected.label} for ${target.label}`,
      manifest: selected.manifest,
    });
    if (!editedManifest) continue;

    const dryRun = await args.operations.importBankTemplate({
      bank: target.bank,
      manifest: editedManifest,
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
      manifest: editedManifest,
      dryRun: false,
    });
    args.ctx.ui.notify(
      `Imported ${selected.label} template into ${applied.bankId}: ${summarizeBankTemplateImportResult(applied.result)}`,
      "info",
    );
    appliedTemplates.push({
      bank: applied.bankId,
      location: target.location,
      label: selected.label,
      ...(selected.profileId ? { profileId: selected.profileId } : {}),
      mentalModels: editedManifest.mental_models ?? [],
    });
  }
  return appliedTemplates;
}

export function importChoicesForSetup(args: {
  setupProfile: SetupProfileChoice;
  appliedProfiles: Set<BankTemplateProfileId>;
  projectBankId?: string;
  globalBankId?: string;
}): string[] {
  const choices = ["Skip import"];
  const profileHints = args.appliedProfiles;
  const canProject = args.setupProfile !== "global-only" && Boolean(args.projectBankId);
  const canGateway = args.setupProfile !== "project-only" && Boolean(args.globalBankId);
  const wantsProject = profileHints.has("coding-project") || (!profileHints.size && canProject);
  const wantsGateway =
    profileHints.has("assistant-personal") ||
    profileHints.has("general-user") ||
    (!profileHints.size && canGateway);
  if (canProject && wantsProject) choices.push("Preview repo Pi sessions");
  if (canGateway && wantsGateway) choices.push("Preview gateway transcript");
  if (canProject && !choices.includes("Preview repo Pi sessions")) {
    choices.push("Preview repo Pi sessions");
  }
  if (canGateway && !choices.includes("Preview gateway transcript")) {
    choices.push("Preview gateway transcript");
  }
  return choices;
}

function operationSummary(result: unknown): string {
  if (typeof result !== "object" || !result) return "operation accepted";
  const fields = result as {
    operation_id?: unknown;
    operationId?: unknown;
    id?: unknown;
    status?: unknown;
  };
  const id = [fields.operation_id, fields.operationId, fields.id].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  const status =
    typeof fields.status === "string" && fields.status.trim() ? fields.status.trim() : undefined;
  return [id?.trim(), status].filter(Boolean).join(" / ") || "operation accepted";
}

async function maybeOfferMentalModelRefreshForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  bankId: string;
  location: "Project" | "User";
  appliedTemplates?: AppliedTemplateTarget[];
}): Promise<void> {
  const mentalModels = (args.appliedTemplates ?? [])
    .filter((template) => template.bank === args.bankId && template.location === args.location)
    .flatMap((template) => template.mentalModels);
  if (mentalModels.length === 0) return;
  const warnings = mentalModels.flatMap((model) =>
    model.tags?.length
      ? [`${model.name} uses tags [${model.tags.join(", ")}]; refresh only sees matching memories.`]
      : [],
  );
  const confirmed = await args.ctx.ui.confirm(
    `Refresh ${mentalModels.length} mental model${mentalModels.length === 1 ? "" : "s"} for ${args.location} bank ${args.bankId}?`,
    [
      "Source import is complete. Refresh is explicit and does not replace retained source material.",
      "Target mental models:",
      ...mentalModels.map((model) => `- ${model.name} (${model.id})`),
      ...(warnings.length ? ["Warnings:", ...warnings.map((warning) => `- ${warning}`)] : []),
    ].join("\n"),
  );
  if (!confirmed) return;
  const refreshed: string[] = [];
  const failed: string[] = [];
  for (const model of mentalModels) {
    try {
      const result = await args.operations.refreshMentalModel({
        bank: args.bankId,
        mentalModelId: model.id,
      });
      refreshed.push(`${model.name}: ${operationSummary(result.result)}`);
    } catch (error) {
      failed.push(`${model.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (refreshed.length) {
    args.ctx.ui.notify(`Queued mental model refresh:\n${refreshed.join("\n")}`, "info");
  }
  if (failed.length) {
    args.ctx.ui.notify(`Mental model refresh failed:\n${failed.join("\n")}`, "warning");
  }
}

export async function maybeOfferHistoricalImportForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  setupProfile: SetupProfileChoice;
  appliedTemplates?: AppliedTemplateTarget[];
  cwd: string;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<void> {
  const proceed = await args.ctx.ui.confirm(
    "Preview historical import now?",
    "Imports always dry-run first. Project profiles use repo Pi sessions; user profiles can import gateway/chat transcripts.",
  );
  if (!proceed) return;
  const appliedProfiles = new Set(
    (args.appliedTemplates ?? [])
      .map((template) => template.profileId)
      .filter((profileId): profileId is BankTemplateProfileId => Boolean(profileId)),
  );
  const choice = await args.ctx.ui.select(
    "Choose import source",
    importChoicesForSetup({
      setupProfile: args.setupProfile,
      appliedProfiles,
      ...(args.projectBankId ? { projectBankId: args.projectBankId } : {}),
      ...(args.globalBankId ? { globalBankId: args.globalBankId } : {}),
    }),
  );
  if (!choice || choice === "Skip import") return;

  if (choice === "Preview repo Pi sessions") {
    const currentSessionFile = args.ctx.sessionManager?.getSessionFile?.();
    const dryRun = await args.operations.importProjectSessions({
      cwd: args.cwd,
      ...(currentSessionFile ? { currentSessionFile } : {}),
      ...(args.projectBankId ? { bank: args.projectBankId } : {}),
      dryRun: true,
    });
    const summary = importDocumentSummary({
      documents: dryRun.imported.flatMap((result) => result.documents),
      malformedLineCount: dryRun.malformedLineCount,
    });
    const confirmed = await args.ctx.ui.confirm(
      `Import repo Pi sessions into ${dryRun.bankId}?`,
      `Dry run: sessions=${dryRun.sessionFiles.length}; documents=${dryRun.documentCount}; messages=${dryRun.messageCount}; ${summary}`,
    );
    if (!confirmed) return;
    const result = await args.operations.importProjectSessions({
      cwd: args.cwd,
      ...(currentSessionFile ? { currentSessionFile } : {}),
      ...(args.projectBankId ? { bank: args.projectBankId } : {}),
      dryRun: false,
    });
    args.ctx.ui.notify(
      `Imported repo Pi sessions into ${result.bankId}: sessions=${result.sessionFiles.length}; documents=${result.documentCount}; messages=${result.messageCount}`,
      "info",
    );
    await maybeOfferMentalModelRefreshForSetup({
      ctx: args.ctx,
      operations: args.operations,
      bankId: result.bankId,
      location: "Project",
      ...(args.appliedTemplates ? { appliedTemplates: args.appliedTemplates } : {}),
    });
    return;
  }

  const sourceFile = await args.ctx.ui.input("Gateway transcript JSONL path", "");
  if (!sourceFile?.trim()) return;
  const dryRun = await args.operations.importGatewayTranscript({
    sourceFile: sourceFile.trim(),
    cwd: args.cwd,
    ...(args.globalBankId ? { bank: args.globalBankId } : {}),
    dryRun: true,
  });
  const confirmed = await args.ctx.ui.confirm(
    `Import gateway transcript into ${dryRun.bankId}?`,
    `Dry run: kept=${dryRun.keptEventCount}; turns=${dryRun.retainedTurnCount}; dropped=${dryRun.droppedEventCount}; malformed=${dryRun.malformedLineCount}; document=${dryRun.documentId}`,
  );
  if (!confirmed) return;
  const result = await args.operations.importGatewayTranscript({
    sourceFile: sourceFile.trim(),
    cwd: args.cwd,
    ...(args.globalBankId ? { bank: args.globalBankId } : {}),
    dryRun: false,
  });
  args.ctx.ui.notify(
    result.skipped
      ? `Gateway import skipped: ${result.skipReason}`
      : `Imported gateway transcript into ${result.bankId} as ${result.documentId}`,
    "info",
  );
  if (!result.skipped) {
    await maybeOfferMentalModelRefreshForSetup({
      ctx: args.ctx,
      operations: args.operations,
      bankId: result.bankId,
      location: "User",
      ...(args.appliedTemplates ? { appliedTemplates: args.appliedTemplates } : {}),
    });
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
          title: "User bank ID",
          fallback: config.banks.user.bankId ?? "",
        });
  if (setupProfile !== "project-only" && !globalBankId) {
    args.ctx.ui.notify("User bank ID required for user memory profiles.", "warning");
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
    ...(globalBankId ? [`User bank: ${globalBankId}`] : []),
  ].join("\n");
  const confirmed = await args.ctx.ui.confirm("Write Pi Hindsight config?", summary);
  if (!confirmed) return false;

  const operations = createMemoryOperations(args.deps);
  const result = await operations.configure(args.cwd, patch);
  args.ctx.ui.notify(`Wrote ${result.path}`, "info");

  const appliedTemplates = await maybeImportBankTemplate({
    ctx: args.ctx,
    deps: args.deps,
    operations,
    setupProfile,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
  });

  await maybeOfferHistoricalImportForSetup({
    ctx: args.ctx,
    operations,
    setupProfile,
    appliedTemplates,
    cwd: args.cwd,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
  });
  return true;
}
