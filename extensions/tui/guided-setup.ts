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
import type { AgentUseProfile, HindsightLikeClient, ResolvedConfig } from "../types.js";
import { defaultTemplateIdFor } from "../banks/bank-templates.js";
import {
  renderBankTemplateApplyResult,
  renderBankTemplateMentalModelDetails,
} from "./bank-template-presentation.js";
import { ensureServerConnectionForSetup } from "./setup-server-probe.js";

export function hasProjectHindsightConfig(cwd: string): boolean {
  return (
    existsSync(join(cwd, ".pi", "hindsight.json")) ||
    existsSync(join(cwd, ".pi", "hindsight.jsonc"))
  );
}

export function setupProfileChoiceToMemoryProfile(choice: SetupProfileChoice): MemoryProfile {
  if (choice === "project-user") return "project+global";
  if (choice === "user-only") return "global-only";
  if (choice === "isolated-only") return "project-only";
  return choice;
}

function profileUsesProject(profile: SetupProfileChoice): boolean {
  return (
    profile === "project-user" ||
    profile === "project-only" ||
    profile === "isolated-only" ||
    profile === "recall-only"
  );
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
    setupComplete: true,
    // Domain-tagged shares one coding bank + project tags; isolated keeps a hard wall.
    scopeMode: args.profile === "isolated-only" ? "isolated-bank" : "domain-tagged",
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

/**
 * Durable per-repo opt-out: automatic memory stays off, setup gate is satisfied
 * so `/hindsight` stops re-prompting, status bar is cleared (style off), and tools
 * refuse execution until re-enabled. Hub commands remain available to re-enable.
 */
export function buildIgnoreRepoPatch(): ProjectConfigPatchInput {
  return { enabled: false, setupComplete: true, statusStyle: "off" };
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

/** Setup-time snapshot of a bank's mental-model catalog from the API. */
export interface SetupBankMentalModelProbe {
  target: "project" | "user";
  bankId: string;
  /** False when getBankProfile reports not found (or no profile API). */
  bankExists: boolean;
  modelNames: string[];
  error?: string;
}

/** Extract mental-model names from a listMentalModels response body. */
export function extractMentalModelNames(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];
  const body = response as { items?: unknown; mental_models?: unknown };
  const rows = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.mental_models)
      ? body.mental_models
      : [];
  const names: string[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { name?: unknown; id?: unknown };
    if (typeof row.name === "string" && row.name.trim()) names.push(row.name.trim());
    else if (typeof row.id === "string" && row.id.trim()) names.push(row.id.trim());
  }
  return names;
}

/**
 * Decide which setup targets should be offered starter mental models.
 * Existing banks that already have models are not offered by default.
 * Probe failures are not auto-offered (hub remains the intentional path).
 */
export function selectMentalModelTargetsToOffer(probes: SetupBankMentalModelProbe[]): {
  toOffer: SetupBankMentalModelProbe[];
  alreadyProvisioned: SetupBankMentalModelProbe[];
  unknown: SetupBankMentalModelProbe[];
} {
  const toOffer: SetupBankMentalModelProbe[] = [];
  const alreadyProvisioned: SetupBankMentalModelProbe[] = [];
  const unknown: SetupBankMentalModelProbe[] = [];
  for (const probe of probes) {
    if (probe.error) {
      unknown.push(probe);
      continue;
    }
    if (probe.bankExists && probe.modelNames.length > 0) {
      alreadyProvisioned.push(probe);
      continue;
    }
    // New bank or existing empty catalog → offer starter provision.
    toOffer.push(probe);
  }
  return { toOffer, alreadyProvisioned, unknown };
}

export async function probeBankMentalModels(args: {
  client: HindsightLikeClient;
  target: "project" | "user";
  bankId: string;
}): Promise<SetupBankMentalModelProbe> {
  const bankId = args.bankId.trim();
  if (!bankId) {
    return {
      target: args.target,
      bankId: "",
      bankExists: false,
      modelNames: [],
      error: "missing bank id",
    };
  }

  let bankExists = false;
  if (args.client.getBankProfile) {
    try {
      await args.client.getBankProfile(bankId);
      bankExists = true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return { target: args.target, bankId, bankExists: false, modelNames: [] };
      }
      return {
        target: args.target,
        bankId,
        bankExists: false,
        modelNames: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    // Without profile API, assume the bank may exist and still list models.
    bankExists = true;
  }

  if (!args.client.listMentalModels) {
    return {
      target: args.target,
      bankId,
      bankExists,
      modelNames: [],
      ...(bankExists ? { error: "listMentalModels unavailable" } : {}),
    };
  }

  try {
    const response = await args.client.listMentalModels(bankId);
    return {
      target: args.target,
      bankId,
      bankExists,
      modelNames: extractMentalModelNames(response),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { target: args.target, bankId, bankExists: false, modelNames: [] };
    }
    return {
      target: args.target,
      bankId,
      bankExists,
      modelNames: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatExistingMentalModelsSummary(probe: SetupBankMentalModelProbe): string {
  const preview = probe.modelNames.slice(0, 6).join(", ");
  const more = probe.modelNames.length > 6 ? ` (+${probe.modelNames.length - 6} more)` : "";
  return `${probe.target} bank ${probe.bankId}: ${probe.modelNames.length} mental model(s) already present (${preview}${more}). Skipping starter provision; use hub (t) to re-apply intentionally.`;
}

async function maybeOfferMentalModelsForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  client: HindsightLikeClient;
  agentUse: AgentUseProfile;
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
}): Promise<void> {
  const targets: Array<{ target: "project" | "user"; bankId: string }> = [];
  if (profileUsesProject(args.setupProfile) && args.projectBankId?.trim()) {
    targets.push({ target: "project", bankId: args.projectBankId.trim() });
  }
  if (profileUsesUser(args.setupProfile) && args.globalBankId?.trim()) {
    targets.push({ target: "user", bankId: args.globalBankId.trim() });
  }
  if (targets.length === 0) return;

  const probes: SetupBankMentalModelProbe[] = [];
  for (const entry of targets) {
    probes.push(
      await probeBankMentalModels({
        client: args.client,
        target: entry.target,
        bankId: entry.bankId,
      }),
    );
  }

  const { toOffer, alreadyProvisioned, unknown } = selectMentalModelTargetsToOffer(probes);

  for (const probe of alreadyProvisioned) {
    args.ctx.ui.notify(formatExistingMentalModelsSummary(probe), "info");
  }
  for (const probe of unknown) {
    args.ctx.ui.notify(
      `Could not inspect ${probe.target} bank ${probe.bankId || "(missing id)"} for mental models: ${probe.error}. Skipping automatic starter provision; use hub (t) if needed.`,
      "warning",
    );
  }

  if (toOffer.length === 0) return;

  const bankSummary = toOffer
    .map((probe) =>
      probe.bankExists
        ? `${probe.target}=${probe.bankId} (exists, empty catalog)`
        : `${probe.target}=${probe.bankId} (new or missing)`,
    )
    .join("; ");
  const proceed = await args.ctx.ui.confirm(
    "Provision starter mental models?",
    `Agent use: ${args.agentUse}. Targets: ${bankSummary}. Dry-run preview first; nothing is written without confirmation. Mental models become part of automatic context when present.`,
  );
  if (!proceed) return;

  for (const probe of toOffer) {
    const templateId = defaultTemplateIdFor(probe.target, args.agentUse);
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

  // Health-check Hindsight before profile/banks so missing server/key fails early.
  const serverOk = await ensureServerConnectionForSetup({
    ctx: args.ctx,
    deps: args.deps,
    cwd: args.cwd,
  });
  if (!serverOk) return false;

  const profile = await args.ctx.ui.select("Choose memory profile", [
    "Coding (shared coding bank + project tags)",
    "Coding + Life (coding bank + user bank)",
    "Isolated project (hard wall bank per repo)",
    "Life only (user bank)",
    "Recall only",
  ]);
  if (!profile) return false;

  const setupProfile = {
    "Coding (shared coding bank + project tags)": "project-only",
    "Coding + Life (coding bank + user bank)": "project-user",
    "Isolated project (hard wall bank per repo)": "isolated-only",
    "Life only (user bank)": "user-only",
    "Recall only": "recall-only",
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
        title:
          setupProfile === "isolated-only"
            ? "Isolated project bank ID (optional; leave default for path-derived)"
            : "Coding bank ID (shared across repos with project tags)",
        fallback:
          config.banks.project.bankId ??
          (setupProfile === "isolated-only" ? args.deps.getProjectBankId() : "pi-coding"),
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
    client: args.deps.getClient(),
    agentUse,
    setupProfile,
    ...(projectBankId !== undefined ? { projectBankId } : {}),
    ...(globalBankId !== undefined ? { globalBankId } : {}),
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
