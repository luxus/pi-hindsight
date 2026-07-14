import type { BankMissionSettings, HindsightLikeClient } from "../types.js";

const DEFAULT_PROJECT_REFLECT_MISSION =
  "You are a senior developer helping a Pi coding agent. Prefer past technical decisions, architecture trade-offs, conventions, and constraints. Be direct and opinionated when memory supports it; do not invent facts not grounded in memory.";

const DEFAULT_PROJECT_RETAIN_MISSION =
  "Always extract technical decisions, API/architecture trade-offs, blockers, error resolutions, repo conventions, and durable project-local preferences. Ignore greetings, small talk, scheduling logistics, secrets, probe/bait harness instructions (e.g. temporary 'do not ask questions' test rules), and resurfaced recalled memory unless it adds a new correction or decision.";

const DEFAULT_PROJECT_OBSERVATIONS_MISSION =
  "Identify evolving durable project patterns, recurring constraints, architectural preferences, and contradictions with prior knowledge. Focus on stable repo-relevant knowledge — not transient task state, one-off plans, or test-harness noise.";

const DEFAULT_GLOBAL_REFLECT_MISSION =
  "You are a coding assistant with durable cross-project context. Personalize using stable user preferences, workflows, and communication style. Be direct; prefer high-signal clarifications over speculation.";

const DEFAULT_GLOBAL_RETAIN_MISSION =
  "Extract durable cross-project memory: user preferences (including clarification/communication style), recurring workflows, coding habits, and stable assistant behavior. Ignore greetings, secrets, probe/bait session rules, repo-specific code facts, file paths, and project-local bugs unless they generalize across projects.";

const DEFAULT_GLOBAL_OBSERVATIONS_MISSION =
  "Identify durable cross-project preferences, recurring workflows, coding habits, and stable assistant behavior patterns. Highlight contradictions with prior knowledge. Ignore repo-specific implementation details and one-off probe constraints unless they generalize.";

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

export interface BankMissionConfig extends BankMissionSettings {
  enableObservations?: boolean;
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

async function bankNeedsCreate(client: HindsightLikeClient, bankId: string): Promise<boolean> {
  if (!client.getBankProfile) return false;
  try {
    await client.getBankProfile(bankId);
    return false;
  } catch (error) {
    if (isNotFoundError(error)) return true;
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
  const missions = resolveBankMissions(config, defaultGlobalBankMissions());
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
