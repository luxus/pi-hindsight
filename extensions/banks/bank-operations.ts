import type { AgentUseProfile, BankMissionSettings, HindsightLikeClient } from "../types.js";

const DEFAULT_PROJECT_REFLECT_MISSION =
  "You are a senior developer helping a Pi coding agent. Prefer past technical decisions, architecture trade-offs, conventions, and constraints. Be direct and opinionated when memory supports it; do not invent facts not grounded in memory.";

const DEFAULT_PROJECT_RETAIN_MISSION =
  "Always extract technical decisions, API/architecture trade-offs, blockers, error resolutions, repo conventions, and durable project-local preferences. " +
  "CRITICAL for conversations: record ONLY the FINAL settled state as what is in effect — when the same rule is amended, keep only the LAST choice; superseded proposals appear only as rejected alternatives, never as active decisions. " +
  "Ignore greetings, small talk, scheduling logistics, secrets, probe/bait harness instructions (e.g. temporary 'do not ask questions' test rules), and resurfaced recalled memory unless it adds a new correction or decision.";

const DEFAULT_PROJECT_OBSERVATIONS_MISSION =
  "Identify evolving durable project patterns, recurring constraints, architectural preferences, and contradictions with prior knowledge. Focus on stable repo-relevant knowledge — not transient task state, one-off plans, or test-harness noise.";

const DEFAULT_GLOBAL_REFLECT_MISSION =
  "You are a coding assistant with durable cross-project context. Personalize using stable user preferences, workflows, and communication style. Be direct; prefer high-signal clarifications over speculation.";

const DEFAULT_GLOBAL_RETAIN_MISSION =
  "Extract durable cross-project memory: user preferences (including clarification/communication style), recurring workflows, coding habits, and stable assistant behavior. Ignore greetings, secrets, probe/bait session rules, repo-specific code facts, file paths, and project-local bugs unless they generalize across projects.";

const DEFAULT_GLOBAL_OBSERVATIONS_MISSION =
  "Identify durable cross-project preferences, recurring workflows, coding habits, and stable assistant behavior patterns. Highlight contradictions with prior knowledge. Ignore repo-specific implementation details and one-off probe constraints unless they generalize.";

/** Life / conversation user bank — personal durable context, not coding-repo facts. */
const DEFAULT_LIFE_REFLECT_MISSION =
  "You are a personal assistant with durable life and task context. Use stable preferences, commitments, people/context, and planning habits. Be concise and practical; prefer high-signal clarifications over speculation. Do not invent personal facts not grounded in memory.";

const DEFAULT_LIFE_RETAIN_MISSION =
  "Extract durable personal and life-task memory: communication preferences, commitments, deadlines, people/roles/context, planning and prioritization habits, and stable constraints. Ignore greetings, secrets, probe/bait harness rules, and repo-specific engineering details (file paths, bugs, PR mechanics) unless they are truly personal durable preferences.";

const DEFAULT_LIFE_OBSERVATIONS_MISSION =
  "Identify durable life and task patterns: recurring preferences, commitments, relationship/context patterns, and planning habits. Highlight contradictions with prior knowledge. Ignore transient chat filler, one-off logistics, and coding-repo implementation noise.";

export interface BankMissionDefaults {
  reflectMission: string;
  retainMission: string;
  observationsMission: string;
}

export function defaultProjectBankMissions(): BankMissionDefaults {
  return {
    reflectMission: DEFAULT_PROJECT_REFLECT_MISSION,
    retainMission: DEFAULT_PROJECT_RETAIN_MISSION,
    observationsMission: DEFAULT_PROJECT_OBSERVATIONS_MISSION,
  };
}

export function defaultGlobalBankMissions(): BankMissionDefaults {
  return {
    reflectMission: DEFAULT_GLOBAL_REFLECT_MISSION,
    retainMission: DEFAULT_GLOBAL_RETAIN_MISSION,
    observationsMission: DEFAULT_GLOBAL_OBSERVATIONS_MISSION,
  };
}

/** Defaults for Life / conversation user bank (agentUse conversation). */
export function defaultLifeBankMissions(): BankMissionDefaults {
  return {
    reflectMission: DEFAULT_LIFE_REFLECT_MISSION,
    retainMission: DEFAULT_LIFE_RETAIN_MISSION,
    observationsMission: DEFAULT_LIFE_OBSERVATIONS_MISSION,
  };
}

/** User/life bank defaults: conversation → life missions; coding → cross-project coding prefs. */
export function defaultUserBankMissions(agentUse: AgentUseProfile = "coding"): BankMissionDefaults {
  return agentUse === "conversation" ? defaultLifeBankMissions() : defaultGlobalBankMissions();
}

export interface BankMissionConfig extends BankMissionSettings {
  enableObservations?: boolean;
  /** Selects life vs coding-user mission defaults when creating a user bank. */
  agentUse?: AgentUseProfile;
}

export function resolveBankMissions(
  config: BankMissionSettings,
  defaults: BankMissionDefaults,
): BankMissionDefaults {
  return {
    reflectMission: config.reflectMission ?? defaults.reflectMission,
    retainMission: config.retainMission ?? defaults.retainMission,
    observationsMission: config.observationsMission ?? defaults.observationsMission,
  };
}

function errorFields(error: unknown): {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
} {
  if (typeof error !== "object" || !error) return {};
  return error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
}

function isHttpStatus(error: unknown, status: number): boolean {
  const fields = errorFields(error);
  return (
    fields.status === status ||
    fields.statusCode === status ||
    fields.code === status ||
    fields.code === String(status)
  );
}

function isNotFoundError(error: unknown): boolean {
  if (isHttpStatus(error, 404)) return true;
  const message = errorFields(error).message;
  return typeof message === "string" && /\b404\b|not found/i.test(message);
}

function isGoneError(error: unknown): boolean {
  if (isHttpStatus(error, 410)) return true;
  const message = errorFields(error).message;
  return (
    typeof message === "string" &&
    (/\b410\b/.test(message) || /bank profile endpoints have been removed/i.test(message))
  );
}

const LIST_BANKS_PAGE_SIZE = 100;
const LIST_BANKS_MAX_OFFSET = 10_000;

function listedBankIds(result: unknown): string[] | undefined {
  if (typeof result !== "object" || !result) return undefined;
  const banks = (result as { banks?: unknown }).banks;
  if (!Array.isArray(banks)) return undefined;
  return banks.flatMap((item) => {
    if (typeof item !== "object" || !item) return [];
    const record = item as { bank_id?: unknown; bankId?: unknown };
    const id = record.bank_id ?? record.bankId;
    return typeof id === "string" ? [id] : [];
  });
}

/** Official v0.10 existence check: GET /banks?q= plus exact bank_id match (Hindsight #4127). */
async function bankExistsViaList(
  client: HindsightLikeClient,
  bankId: string,
): Promise<boolean | undefined> {
  if (!client.listBanks) return undefined;
  try {
    for (let offset = 0; offset <= LIST_BANKS_MAX_OFFSET; offset += LIST_BANKS_PAGE_SIZE) {
      const listed = await client.listBanks({
        q: bankId,
        limit: LIST_BANKS_PAGE_SIZE,
        ...(offset > 0 ? { offset } : {}),
      });
      const ids = listedBankIds(listed);
      if (!ids) return undefined;
      if (ids.includes(bankId)) return true;
      if (ids.length < LIST_BANKS_PAGE_SIZE) return false;
    }
    // Truncated after the scan cap: do not create (avoids mission overwrite).
    return undefined;
  } catch {
    return undefined;
  }
}

async function bankNeedsCreate(client: HindsightLikeClient, bankId: string): Promise<boolean> {
  const listed = await bankExistsViaList(client, bankId);
  if (listed === true) return false;
  if (listed === false) return true;

  if (!client.getBankProfile) return false;
  try {
    await client.getBankProfile(bankId);
    return false;
  } catch (error) {
    if (isNotFoundError(error)) return true;
    // Profile retired in Hindsight v0.10.0 (#4127). Without a list result, do not create
    // (avoids create-or-update overwriting missions on an existing bank).
    if (isGoneError(error)) return false;
    throw error;
  }
}

export async function ensureProjectBank(
  client: HindsightLikeClient,
  bankId: string,
  config: BankMissionConfig = {},
): Promise<void> {
  if (!client.createBank || !(await bankNeedsCreate(client, bankId))) return;
  const missions = resolveBankMissions(config, defaultProjectBankMissions());
  await client.createBank(bankId, {
    name: bankId,
    ...missions,
    retainExtractionMode: "concise",
    enableObservations: config.enableObservations ?? true,
    ...(config.retainStructuredChunkSize !== undefined
      ? { retainStructuredChunkSize: config.retainStructuredChunkSize }
      : {}),
  });
}

export async function ensureGlobalBank(
  client: HindsightLikeClient,
  bankId: string,
  config: BankMissionConfig = {},
): Promise<void> {
  if (!client.createBank || !(await bankNeedsCreate(client, bankId))) return;
  const missions = resolveBankMissions(
    config,
    defaultUserBankMissions(config.agentUse ?? "coding"),
  );
  await client.createBank(bankId, {
    name: bankId,
    ...missions,
    retainExtractionMode: "concise",
    enableObservations: config.enableObservations ?? true,
    ...(config.retainStructuredChunkSize !== undefined
      ? { retainStructuredChunkSize: config.retainStructuredChunkSize }
      : {}),
  });
}
