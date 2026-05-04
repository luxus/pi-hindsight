import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { redactError } from "./sanitize.js";

export type StatusHealthFacts = Array<[string, string]>;

type BankRoute = { label: "Project bank" | "User bank"; bankId: string };
const STATUS_HEALTH_TIMEOUT_MS = 1_500;

async function withStatusTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${STATUS_HEALTH_TIMEOUT_MS}ms`)),
          STATUS_HEALTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : undefined;
}

function dateField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function bankRoutes(config: ResolvedConfig, projectBankId: string): BankRoute[] {
  return [
    ...(config.banks.project.enabled
      ? [{ label: "Project bank" as const, bankId: projectBankId }]
      : []),
    ...(config.banks.user.enabled && config.banks.user.bankId
      ? [{ label: "User bank" as const, bankId: config.banks.user.bankId }]
      : []),
  ];
}

function textField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function missionSummary(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

function formatMissionConfig(configResponse: unknown): string | undefined {
  const config = nestedRecord(configResponse, "config");
  const overrides = nestedRecord(configResponse, "overrides");
  const retain =
    textField(overrides, "retain_custom_instructions") ??
    textField(overrides, "retain_mission") ??
    textField(config, "retain_custom_instructions") ??
    textField(config, "retain_mission");
  const reflect = textField(overrides, "reflect_mission") ?? textField(config, "reflect_mission");
  const observations =
    textField(overrides, "observations_mission") ?? textField(config, "observations_mission");
  const parts = [
    retain ? `retain ${missionSummary(retain)}` : undefined,
    reflect ? `reflect ${missionSummary(reflect)}` : undefined,
    observations ? `observations ${missionSummary(observations)}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function formatStats(stats: unknown): string | undefined {
  const memories = numberField(stats, "total_nodes");
  const documents = numberField(stats, "total_documents");
  const observations = numberField(stats, "total_observations");
  const pending = numberField(stats, "pending_consolidation");
  const failed = numberField(stats, "failed_consolidation");
  const last = dateField(stats, "last_consolidated_at");
  const parts = [
    memories !== undefined ? `memories ${memories}` : undefined,
    documents !== undefined ? `docs ${documents}` : undefined,
    observations !== undefined ? `observations ${observations}` : undefined,
    pending !== undefined ? `pending ${pending}` : undefined,
    failed !== undefined ? `failed ${failed}` : undefined,
    last ? `last consolidated ${last}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

async function bankFact(client: HindsightLikeClient, route: BankRoute): Promise<StatusHealthFacts> {
  try {
    const profile = client.getBankProfile
      ? await withStatusTimeout(client.getBankProfile(route.bankId), `${route.label} profile`)
      : undefined;
    const name =
      isRecord(profile) && typeof profile.name === "string" ? profile.name : route.bankId;
    const facts: StatusHealthFacts = [[route.label, `reachable · ${name}`]];
    if (client.getBankConfig) {
      try {
        const config = await withStatusTimeout(
          client.getBankConfig(route.bankId),
          `${route.label} config`,
        );
        const summary = formatMissionConfig(config);
        if (summary) facts.push([`${route.label} missions`, `db · ${summary}`]);
      } catch (error) {
        facts.push([`${route.label} missions`, `unavailable · ${redactError(error)}`]);
      }
    }
    if (client.getBankStats) {
      try {
        const stats = await withStatusTimeout(
          client.getBankStats(route.bankId),
          `${route.label} stats`,
        );
        const summary = formatStats(stats);
        if (summary) facts.push([`${route.label} stats`, summary]);
      } catch (error) {
        facts.push([`${route.label} stats`, `unavailable · ${redactError(error)}`]);
      }
    }
    return facts;
  } catch (error) {
    return [[route.label, `unreachable · ${redactError(error)}`]];
  }
}

export async function collectStatusHealthFacts(args: {
  client: HindsightLikeClient;
  config: ResolvedConfig;
  projectBankId: string;
}): Promise<StatusHealthFacts> {
  const facts: StatusHealthFacts = [];
  try {
    if (args.client.health) await withStatusTimeout(args.client.health(), "Hindsight health");
    facts.push(["Server", "reachable"]);
  } catch (error) {
    facts.push(["Server", `unreachable · ${redactError(error)}`]);
  }

  const routes = bankRoutes(args.config, args.projectBankId);
  if (!routes.length) return [...facts, ["Banks", "none configured"]];
  for (const route of routes) facts.push(...(await bankFact(args.client, route)));
  return facts;
}
