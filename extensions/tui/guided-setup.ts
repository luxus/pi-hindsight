import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  createMemoryOperations,
  type MemoryOperations,
  type MemoryOperationsDeps,
} from "../operations/memory-operation-service.js";
import { importDocumentSummary } from "../imports/import-presentation.js";
import type { ImportProgressEvent } from "../imports/import-sessions.js";
import type { MemoryProfile, ProjectConfigPatchInput } from "../config/config-writer.js";
import type { SetupProfileChoice } from "./setup-tui-types.js";
import type { AgentUseProfile, ResolvedConfig } from "../types.js";
import { defaultTemplateIdFor } from "../banks/bank-templates.js";
import {
  renderBankTemplateApplyResult,
  renderBankTemplateMentalModelDetails,
} from "./bank-template-presentation.js";

export function hasProjectHindsightConfig(cwd: string): boolean {
  return (
    existsSync(join(cwd, ".pi", "hindsight.json")) ||
    existsSync(join(cwd, ".pi", "hindsight.jsonc"))
  );
}

export function setupProfileChoiceToMemoryProfile(choice: SetupProfileChoice): MemoryProfile {
  if (choice === "project-user") return "project+global";
  if (choice === "user-only") return "global-only";
  return choice;
}

function profileUsesProject(profile: SetupProfileChoice): boolean {
  return profile === "project-user" || profile === "project-only" || profile === "recall-only";
}

function profileUsesUser(profile: SetupProfileChoice): boolean {
  return profile === "project-user" || profile === "user-only";
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
    ...(profileUsesProject(args.profile) && args.projectBankId?.trim()
      ? { projectBankId: args.projectBankId.trim() }
      : {}),
    ...(profileUsesUser(args.profile) ? { resetDefaults: ["banks.global.bankId" as const] } : {}),
  };
}

export function buildGuidedSetupGlobalPatch(args: {
  profile: SetupProfileChoice;
  globalBankId?: string;
  config: ResolvedConfig;
}): ProjectConfigPatchInput | undefined {
  if (!profileUsesUser(args.profile)) return undefined;
  const globalBankId = args.globalBankId?.trim() || args.config.banks.user.bankId;
  return {
    scope: "global",
    enableGlobalBank: true,
    ...(globalBankId ? { globalBankId } : {}),
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

export function importChoicesForSetup(args: {
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): string[] {
  const choices = ["Skip import"];
  if (profileUsesProject(args.setupProfile) && args.projectBankId) {
    choices.push("Preview repo Pi sessions");
  }
  if (profileUsesUser(args.setupProfile) && args.globalBankId) {
    choices.push("Preview chat transcript");
  }
  return choices;
}

const DOCS_BASE_URL = "https://luxus.github.io/pi-hindsight";

function setupDocsHint(topic: string, path: string): string {
  return `${topic} docs: ${DOCS_BASE_URL}${path}`;
}

function setupImportProgressMessage(event: ImportProgressEvent): string {
  return `Hindsight import progress: ${event.message}`;
}

async function maybeOfferMentalModelsForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  agentUse: AgentUseProfile;
  setupProfile: SetupProfileChoice;
}): Promise<void> {
  const targets: Array<"project" | "user"> = [];
  if (profileUsesProject(args.setupProfile)) targets.push("project");
  if (profileUsesUser(args.setupProfile)) targets.push("user");
  if (targets.length === 0) return;

  const proceed = await args.ctx.ui.confirm(
    "Provision starter mental models?",
    `Agent use: ${args.agentUse}. Dry-run preview first; nothing is written without confirmation. Mental models become part of automatic context when present.`,
  );
  if (!proceed) return;

  for (const target of targets) {
    const templateId = defaultTemplateIdFor(target, args.agentUse);
    try {
      const dryRun = await args.operations.applyBankTemplate({ templateId, dryRun: true });
      const details = renderBankTemplateMentalModelDetails(dryRun.template);
      const confirmed = await args.ctx.ui.confirm(
        `Apply ${templateId} to ${dryRun.bankId}?`,
        `${details ? `${details}\n\n` : ""}${renderBankTemplateApplyResult(dryRun)}`,
      );
      if (!confirmed) continue;
      const applied = await args.operations.applyBankTemplate({ templateId, dryRun: false });
      args.ctx.ui.notify(renderBankTemplateApplyResult(applied), "info");
    } catch (error) {
      args.ctx.ui.notify(
        `Mental model template ${templateId} skipped: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  }
}

function setupImportProgressReporter(ctx: ExtensionCommandContext) {
  return (event: ImportProgressEvent) => ctx.ui.notify(setupImportProgressMessage(event), "info");
}

export async function maybeOfferHistoricalImportForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  setupProfile: SetupProfileChoice;
  cwd: string;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<void> {
  const proceed = await args.ctx.ui.confirm(
    "Preview historical import now?",
    "Imports always dry-run first. Project profiles use repo Pi sessions; user profiles can import chat transcripts.",
  );
  if (!proceed) return;
  args.ctx.ui.notify(setupDocsHint("Import", "/guides/importing-sessions/"), "info");
  const choice = await args.ctx.ui.select(
    "Choose import source",
    importChoicesForSetup({
      setupProfile: args.setupProfile,
      ...(args.projectBankId ? { projectBankId: args.projectBankId } : {}),
      ...(args.globalBankId ? { globalBankId: args.globalBankId } : {}),
    }),
  );
  if (!choice || choice === "Skip import") return;

  if (choice === "Preview repo Pi sessions") {
    const currentSessionFile = args.ctx.sessionManager?.getSessionFile?.();
    const onProgress = setupImportProgressReporter(args.ctx);
    args.ctx.ui.notify("Preparing repo Pi session import preview...", "info");
    const dryRun = await args.operations.importProjectSessions({
      cwd: args.cwd,
      ...(currentSessionFile ? { currentSessionFile } : {}),
      ...(args.projectBankId ? { bank: args.projectBankId } : {}),
      dryRun: true,
      onProgress,
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
    args.ctx.ui.notify("Starting repo Pi session import write...", "info");
    const result = await args.operations.importProjectSessions({
      cwd: args.cwd,
      ...(currentSessionFile ? { currentSessionFile } : {}),
      ...(args.projectBankId ? { bank: args.projectBankId } : {}),
      dryRun: false,
      onProgress,
    });
    args.ctx.ui.notify(
      `Imported repo Pi sessions into ${result.bankId}: sessions=${result.sessionFiles.length}; documents=${result.documentCount}; messages=${result.messageCount}`,
      "info",
    );
    return;
  }

  const sourceFile = await args.ctx.ui.input("Chat transcript JSONL path", "");
  if (!sourceFile?.trim()) return;
  const onProgress = setupImportProgressReporter(args.ctx);
  args.ctx.ui.notify("Preparing chat transcript import preview...", "info");
  const dryRun = await args.operations.importChatTranscript({
    sourceFile: sourceFile.trim(),
    cwd: args.cwd,
    ...(args.globalBankId ? { bank: args.globalBankId } : {}),
    dryRun: true,
    onProgress,
  });
  const confirmed = await args.ctx.ui.confirm(
    `Import chat transcript into ${dryRun.bankId}?`,
    `Dry run: kept=${dryRun.keptEventCount}; turns=${dryRun.retainedTurnCount}; dropped=${dryRun.droppedEventCount}; malformed=${dryRun.malformedLineCount}; document=${dryRun.documentId}`,
  );
  if (!confirmed) return;
  args.ctx.ui.notify("Starting chat transcript import write...", "info");
  const result = await args.operations.importChatTranscript({
    sourceFile: sourceFile.trim(),
    cwd: args.cwd,
    ...(args.globalBankId ? { bank: args.globalBankId } : {}),
    dryRun: false,
    onProgress,
  });
  args.ctx.ui.notify(
    result.skipped
      ? `Chat transcript import skipped: ${result.skipReason}`
      : `Imported chat transcript into ${result.bankId} as ${result.documentId}`,
    "info",
  );
}

export async function runGuidedSetup(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  cwd: string;
}): Promise<boolean> {
  args.ctx.ui.notify(setupDocsHint("Guided setup", "/start/setup-tui/"), "info");
  args.ctx.ui.notify(setupDocsHint("Memory profiles", "/start/memory-profiles/"), "info");
  const profile = await args.ctx.ui.select("Choose memory profile", [
    "Project + User",
    "Project Only",
    "User Only",
    "Recall Only",
  ]);
  if (!profile) return false;

  const setupProfile = {
    "Project + User": "project-user",
    "Project Only": "project-only",
    "User Only": "user-only",
    "Recall Only": "recall-only",
  }[profile] as SetupProfileChoice;

  const agentUseLabel = await args.ctx.ui.select("How do you use this Pi agent?", [
    "Coding (architecture, conventions, decisions)",
    "Conversation / real-life tasks (goals, people, commitments)",
  ]);
  if (!agentUseLabel) return false;
  const agentUse = agentUseLabel.startsWith("Conversation")
    ? ("conversation" as const)
    : ("coding" as const);

  const config = args.deps.getConfig();
  const projectBankId = profileUsesProject(setupProfile)
    ? await askBankId({
        ctx: args.ctx,
        title: "Project bank ID",
        fallback: config.banks.project.bankId ?? args.deps.getProjectBankId(),
      })
    : undefined;
  if (profileUsesProject(setupProfile) && projectBankId === undefined) return false;

  const globalBankId = profileUsesUser(setupProfile)
    ? await askBankId({
        ctx: args.ctx,
        title: "User bank ID",
        fallback: config.banks.user.bankId ?? "",
      })
    : undefined;
  if (profileUsesUser(setupProfile) && !globalBankId) {
    args.ctx.ui.notify("User bank ID required for user memory profiles.", "warning");
    return false;
  }

  const patch = {
    ...buildGuidedSetupPatch({
      profile: setupProfile,
      ...(projectBankId !== undefined ? { projectBankId } : {}),
      ...(globalBankId !== undefined ? { globalBankId } : {}),
      config,
    }),
    agentUse,
  };
  const globalPatch = buildGuidedSetupGlobalPatch({
    profile: setupProfile,
    ...(globalBankId !== undefined ? { globalBankId } : {}),
    config,
  });
  const summary = [
    `Profile: ${setupProfileChoiceToMemoryProfile(setupProfile)}`,
    `Agent use: ${agentUse}`,
    ...(projectBankId ? [`Project config: project bank ${projectBankId}`] : []),
    ...(globalBankId ? [`Global config: user bank ${globalBankId}`] : []),
    ...(setupProfile === "recall-only"
      ? ["Automatic retain: disabled; automatic recall: enabled"]
      : []),
  ].join("\n");
  const confirmed = await args.ctx.ui.confirm("Write Pi Hindsight config?", summary);
  if (!confirmed) return false;

  const operations = createMemoryOperations(args.deps);
  if (globalPatch) {
    const globalResult = await operations.configure(args.cwd, globalPatch);
    args.ctx.ui.notify(`Wrote ${globalResult.path}`, "info");
  }
  const result = await operations.configure(args.cwd, patch);
  args.ctx.ui.notify(`Wrote ${result.path}`, "info");

  await maybeOfferMentalModelsForSetup({
    ctx: args.ctx,
    operations,
    agentUse,
    setupProfile,
  });

  await maybeOfferHistoricalImportForSetup({
    ctx: args.ctx,
    operations,
    setupProfile,
    cwd: args.cwd,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
  });
  return true;
}
