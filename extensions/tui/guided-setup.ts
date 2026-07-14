import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ensureGlobalBank, ensureProjectBank } from "../banks/bank-operations.js";
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
import { defaultTemplateIdFor, expectedStarterMentalModelIds } from "../banks/bank-templates.js";
import { resolveProjectIdentity } from "../banks/banking.js";
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

export type BankExistence =
  | { status: "exists" }
  | { status: "missing" }
  | { status: "unknown"; error?: string };

/** Check whether a bank ID already exists in Hindsight (typo protection for setup). */
export async function probeBankExistence(
  client: HindsightLikeClient,
  bankId: string,
): Promise<BankExistence> {
  const id = bankId.trim();
  if (!id) return { status: "unknown", error: "missing bank id" };
  if (!client.getBankProfile) {
    return { status: "unknown", error: "getBankProfile unavailable" };
  }
  try {
    await client.getBankProfile(id);
    return { status: "exists" };
  } catch (error) {
    if (isNotFoundError(error)) return { status: "missing" };
    return {
      status: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type SetupBankResolveState = "existing" | "created" | "unverified";

export type ResolvedSetupBank = {
  bankId: string;
  state: SetupBankResolveState;
};

/** One-line status after server + bank resolution. */
export function formatSetupBankStatusLine(args: {
  serverReachable: boolean;
  banks: Array<{ kind: "project" | "user"; bankId: string; state: SetupBankResolveState }>;
}): string {
  const server = args.serverReachable ? "Server: reachable" : "Server: offline";
  if (args.banks.length === 0) return server;
  const bankParts = args.banks.map((bank) => `${bank.kind} bank ${bank.bankId}: ${bank.state}`);
  return `${server} · ${bankParts.join(" · ")}`;
}

/**
 * Collect a bank ID, verify it against Hindsight, and confirm create when missing
 * so typos do not silently mint a new bank.
 * Returns undefined when the user cancels input.
 * When offline, skips network probe/create and accepts the ID as unverified.
 */
export async function resolveSetupBankId(args: {
  ctx: ExtensionCommandContext;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  kind: "project" | "user";
  title: string;
  fallback: string;
  offline?: boolean;
}): Promise<ResolvedSetupBank | undefined> {
  while (true) {
    const bankId = await askBankId({
      ctx: args.ctx,
      title: args.title,
      fallback: args.fallback,
    });
    if (bankId === undefined) return undefined;
    const trimmed = bankId.trim();
    if (!trimmed) {
      // Empty IDs are never valid config values (askBankId already falls back when possible).
      args.ctx.ui.notify(
        args.kind === "user"
          ? "User bank ID is required."
          : "Project bank ID is required (cannot be empty).",
        "warning",
      );
      continue;
    }

    if (args.offline) {
      args.ctx.ui.notify(
        `Offline: accepting ${args.kind} bank ${trimmed} without server verification.`,
        "info",
      );
      return { bankId: trimmed, state: "unverified" };
    }

    const existence = await probeBankExistence(args.client, trimmed);
    if (existence.status === "exists") {
      args.ctx.ui.notify(`Using existing ${args.kind} bank ${trimmed}.`, "info");
      return { bankId: trimmed, state: "existing" };
    }

    if (existence.status === "missing") {
      const create = await args.ctx.ui.confirm(
        `Create ${args.kind} bank "${trimmed}"?`,
        `No bank with this ID was found in Hindsight. Confirm create, or cancel to re-enter the ID (typo protection).`,
      );
      if (!create) {
        args.ctx.ui.notify("Bank ID not created. Re-enter the correct bank ID.", "info");
        continue;
      }
      if (!args.client.createBank) {
        args.ctx.ui.notify(
          "Hindsight client cannot create banks. Re-enter an existing bank ID or fix client support.",
          "error",
        );
        continue;
      }
      try {
        if (args.kind === "project") {
          await ensureProjectBank(args.client, trimmed, {
            ...args.config.banks.project,
            enableObservations: args.config.observations.enabled,
          });
        } else {
          await ensureGlobalBank(args.client, trimmed, {
            ...args.config.banks.user,
            enableObservations: args.config.observations.enabled,
            agentUse: args.config.agentUse,
          });
        }
        args.ctx.ui.notify(`Created ${args.kind} bank ${trimmed}.`, "info");
        return { bankId: trimmed, state: "created" };
      } catch (error) {
        args.ctx.ui.notify(
          `Failed to create ${args.kind} bank ${trimmed}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        continue;
      }
    }

    // Profile API missing: cannot verify; keep prior behavior.
    if (existence.error === "getBankProfile unavailable") {
      return { bankId: trimmed, state: "unverified" };
    }

    const proceed = await args.ctx.ui.confirm(
      `Could not verify ${args.kind} bank "${trimmed}"`,
      `${existence.error ?? "Unknown error"}. Continue with this ID anyway, or cancel to re-enter?`,
    );
    if (proceed) return { bankId: trimmed, state: "unverified" };
  }
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
  /** Present mental-model ids from listMentalModels (preferred for ensure checks). */
  modelIds: string[];
  /** Expected starter ids for this setup target (resolved template + projectId). */
  expectedModelIds?: string[];
  /** Subset of expectedModelIds not present on the bank. */
  missingModelIds?: string[];
  error?: string;
}

function mentalModelListRows(response: unknown): Array<Record<string, unknown>> {
  if (!response || typeof response !== "object") return [];
  const body = response as { items?: unknown; mental_models?: unknown };
  const rows = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.mental_models)
      ? body.mental_models
      : [];
  return rows.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object"),
  );
}

/** Extract mental-model names from a listMentalModels response body. */
export function extractMentalModelNames(response: unknown): string[] {
  const names: string[] = [];
  for (const row of mentalModelListRows(response)) {
    if (typeof row.name === "string" && row.name.trim()) names.push(row.name.trim());
    else if (typeof row.id === "string" && row.id.trim()) names.push(row.id.trim());
  }
  return names;
}

/** Extract mental-model ids from a listMentalModels response body. */
export function extractMentalModelIds(response: unknown): string[] {
  const ids: string[] = [];
  for (const row of mentalModelListRows(response)) {
    if (typeof row.id === "string" && row.id.trim()) ids.push(row.id.trim());
  }
  return ids;
}

/**
 * Decide which setup targets should be offered starter mental models.
 * When expectedModelIds is set, skip only if every expected id is already present
 * (domain-tagged multi-project: other projects' models must not skip this project).
 * Without expected ids, fall back to empty-catalog offer.
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
    const expected = probe.expectedModelIds ?? [];
    if (expected.length > 0) {
      const have = new Set(probe.modelIds);
      const missing = expected.filter((id) => !have.has(id));
      const next = { ...probe, missingModelIds: missing };
      if (missing.length === 0) alreadyProvisioned.push(next);
      else toOffer.push(next);
      continue;
    }
    if (probe.bankExists && (probe.modelIds.length > 0 || probe.modelNames.length > 0)) {
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
      modelIds: [],
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
        return { target: args.target, bankId, bankExists: false, modelNames: [], modelIds: [] };
      }
      return {
        target: args.target,
        bankId,
        bankExists: false,
        modelNames: [],
        modelIds: [],
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
      modelIds: [],
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
      modelIds: extractMentalModelIds(response),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { target: args.target, bankId, bankExists: false, modelNames: [], modelIds: [] };
    }
    return {
      target: args.target,
      bankId,
      bankExists,
      modelNames: [],
      modelIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatExistingMentalModelsSummary(probe: SetupBankMentalModelProbe): string {
  const expected = probe.expectedModelIds?.length ?? 0;
  if (expected > 0) {
    return `${probe.target} bank ${probe.bankId}: all ${expected} starter mental model(s) already present. Skipping starter provision; use hub (t) to re-apply intentionally.`;
  }
  const preview = probe.modelNames.slice(0, 6).join(", ");
  const more = probe.modelNames.length > 6 ? ` (+${probe.modelNames.length - 6} more)` : "";
  return `${probe.target} bank ${probe.bankId}: ${probe.modelNames.length} mental model(s) already present (${preview}${more}). Skipping starter provision; use hub (t) to re-apply intentionally.`;
}

function formatOfferTargetSummary(probe: SetupBankMentalModelProbe): string {
  const expected = probe.expectedModelIds?.length ?? 0;
  const missing = probe.missingModelIds?.length ?? 0;
  if (expected > 0) {
    const present = expected - missing;
    return `${probe.target}=${probe.bankId} (${present}/${expected} starters present; missing ${missing})`;
  }
  return probe.bankExists
    ? `${probe.target}=${probe.bankId} (exists, empty catalog)`
    : `${probe.target}=${probe.bankId} (new or missing)`;
}

async function maybeOfferMentalModelsForSetup(args: {
  ctx: ExtensionCommandContext;
  operations: MemoryOperations;
  client: HindsightLikeClient;
  agentUse: AgentUseProfile;
  setupProfile: SetupProfileChoice;
  projectBankId?: string;
  globalBankId?: string;
  cwd?: string;
  config?: ResolvedConfig;
}): Promise<void> {
  const targets: Array<{ target: "project" | "user"; bankId: string }> = [];
  if (profileUsesProject(args.setupProfile) && args.projectBankId?.trim()) {
    targets.push({ target: "project", bankId: args.projectBankId.trim() });
  }
  if (profileUsesUser(args.setupProfile) && args.globalBankId?.trim()) {
    targets.push({ target: "user", bankId: args.globalBankId.trim() });
  }
  if (targets.length === 0) return;

  const cwd = args.cwd ?? process.cwd();
  const projectId = args.config ? resolveProjectIdentity(cwd, args.config).projectId : undefined;

  const probes: SetupBankMentalModelProbe[] = [];
  for (const entry of targets) {
    const probe = await probeBankMentalModels({
      client: args.client,
      target: entry.target,
      bankId: entry.bankId,
    });
    const expectedModelIds = expectedStarterMentalModelIds({
      target: entry.target,
      agentUse: args.agentUse,
      ...(entry.target === "project" && projectId ? { projectId } : {}),
      ...(args.config
        ? {
            bankMissionSettings:
              entry.target === "user" ? args.config.banks.user : args.config.banks.project,
          }
        : {}),
    });
    probes.push({
      ...probe,
      ...(expectedModelIds.length > 0 ? { expectedModelIds } : {}),
    });
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

  const bankSummary = toOffer.map(formatOfferTargetSummary).join("; ");
  const proceed = await args.ctx.ui.confirm(
    "Provision starter mental models?",
    `Agent use: ${args.agentUse}. Targets: ${bankSummary}. Ensures bank-global + this project's starters when missing. Dry-run preview first; nothing is written without confirmation. Mental models become part of automatic context when present.`,
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
  const connection = await ensureServerConnectionForSetup({
    ctx: args.ctx,
    deps: args.deps,
    cwd: args.cwd,
  });
  if (!connection.continue) return false;
  const offline = connection.offline;

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
  const client = args.deps.getClient();
  const resolvedBanks: Array<{
    kind: "project" | "user";
    bankId: string;
    state: SetupBankResolveState;
  }> = [];

  const projectBank = profileUsesProject(setupProfile)
    ? await resolveSetupBankId({
        ctx: args.ctx,
        client,
        config,
        kind: "project",
        title:
          setupProfile === "isolated-only"
            ? "Isolated project bank ID (optional; leave default for path-derived)"
            : "Coding bank ID (shared across repos with project tags)",
        fallback:
          config.banks.project.bankId ??
          (setupProfile === "isolated-only" ? args.deps.getProjectBankId() : "pi-coding"),
        offline,
      })
    : undefined;
  if (profileUsesProject(setupProfile) && projectBank === undefined) return false;
  if (projectBank?.bankId) {
    resolvedBanks.push({ kind: "project", bankId: projectBank.bankId, state: projectBank.state });
  }

  const globalBank = profileUsesUser(setupProfile)
    ? await resolveSetupBankId({
        ctx: args.ctx,
        client,
        config,
        kind: "user",
        title: "User bank ID",
        fallback: config.banks.user.bankId ?? "",
        offline,
      })
    : undefined;
  if (profileUsesUser(setupProfile) && !globalBank) {
    args.ctx.ui.notify("User bank ID required for user memory profiles.", "warning");
    return false;
  }
  if (globalBank?.bankId) {
    resolvedBanks.push({ kind: "user", bankId: globalBank.bankId, state: globalBank.state });
  }

  args.ctx.ui.notify(
    formatSetupBankStatusLine({
      serverReachable: connection.serverReachable,
      banks: resolvedBanks,
    }),
    "info",
  );

  const projectBankId = projectBank?.bankId;
  const globalBankId = globalBank?.bankId;

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
    `Server: ${connection.serverReachable ? "reachable" : "offline"}`,
    ...(projectBankId ? [`Project config: project bank ${projectBankId}`] : []),
    ...(globalBankId ? [`Global config: user bank ${globalBankId}`] : []),
    ...(setupProfile === "recall-only"
      ? ["Automatic retain: disabled; automatic recall: enabled"]
      : []),
    ...(offline ? ["Offline: mental models and import will be skipped"] : []),
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

  if (offline) {
    args.ctx.ui.notify(
      "Offline setup complete. Re-run guided setup or use hub (t / i) when the server is reachable for mental models and import.",
      "info",
    );
    return true;
  }

  await maybeOfferMentalModelsForSetup({
    ctx: args.ctx,
    operations,
    client,
    agentUse,
    setupProfile,
    cwd: args.cwd,
    config,
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
