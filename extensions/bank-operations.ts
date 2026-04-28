import type { HindsightLikeClient } from "./types.js";

const DEFAULT_PROJECT_REFLECT_MISSION =
  "Help a Pi coding agent recall project-specific architecture, engineering decisions, conventions, tasks, bugs, fixes, constraints, and continuity.";

const DEFAULT_PROJECT_RETAIN_MISSION =
  "Extract durable project memory from raw Pi coding sessions: architecture decisions, constraints, bugs, fixes, TODOs, repo conventions, and project-local user preferences. Ignore transient chatter, secrets, and resurfaced recalled memories unless they add a new correction or decision.";

const DEFAULT_GLOBAL_REFLECT_MISSION =
  "Help a Pi coding agent recall durable cross-project user preferences, recurring workflows, coding habits, and stable assistant behavior guidance.";

const DEFAULT_GLOBAL_RETAIN_MISSION =
  "Extract durable cross-project memory from raw Pi sessions: user preferences, recurring workflows, coding habits, and stable assistant behavior. Do not retain repo-specific code facts, file paths, project-local bugs, or transcript dumps unless they generalize across projects.";

export interface BankMissionConfig {
  mission?: string;
  enableObservations?: boolean;
}

export async function ensureProjectBank(
  client: HindsightLikeClient,
  bankId: string,
  config: BankMissionConfig = {},
): Promise<void> {
  if (!client.createBank) return;
  await client.createBank(bankId, {
    name: bankId,
    reflectMission: config.mission ?? DEFAULT_PROJECT_REFLECT_MISSION,
    retainMission: config.mission ?? DEFAULT_PROJECT_RETAIN_MISSION,
    retainExtractionMode: "concise",
    enableObservations: config.enableObservations ?? true,
  });
}

export async function ensureGlobalBank(
  client: HindsightLikeClient,
  bankId: string,
  config: BankMissionConfig = {},
): Promise<void> {
  if (!client.createBank) return;
  await client.createBank(bankId, {
    name: bankId,
    reflectMission: config.mission ?? DEFAULT_GLOBAL_REFLECT_MISSION,
    retainMission: config.mission ?? DEFAULT_GLOBAL_RETAIN_MISSION,
    retainExtractionMode: "concise",
    enableObservations: config.enableObservations ?? true,
  });
}
