import type { BankMissionSettings, HindsightLikeClient } from "./types.js";

const DEFAULT_PROJECT_REFLECT_MISSION =
  "Help a Pi coding agent recall project-specific architecture, engineering decisions, conventions, tasks, bugs, fixes, constraints, and continuity.";

const DEFAULT_PROJECT_RETAIN_MISSION =
  "Extract durable project memory from raw Pi coding sessions: architecture decisions, constraints, bugs, fixes, TODOs, repo conventions, and project-local user preferences. Ignore transient chatter, secrets, and resurfaced recalled memories unless they add a new correction or decision.";

const DEFAULT_PROJECT_OBSERVATIONS_MISSION =
  "Identify durable project patterns, recurring constraints, architectural preferences, and contradictions across Pi coding sessions. Focus on stable repo-relevant knowledge, not transient task state.";

const DEFAULT_GLOBAL_REFLECT_MISSION =
  "Help a Pi coding agent recall durable cross-project user preferences, recurring workflows, coding habits, and stable assistant behavior guidance.";

const DEFAULT_GLOBAL_RETAIN_MISSION =
  "Extract durable cross-project memory from raw Pi sessions: user preferences, recurring workflows, coding habits, and stable assistant behavior. Do not retain repo-specific code facts, file paths, project-local bugs, or transcript dumps unless they generalize across projects.";

const DEFAULT_GLOBAL_OBSERVATIONS_MISSION =
  "Identify durable cross-project user preferences, recurring workflows, coding habits, and stable assistant behavior patterns. Ignore repo-specific implementation details unless they generalize across projects.";

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

function resolveBankMissions(config: BankMissionSettings, defaults: BankMissionDefaults) {
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
  });
}
