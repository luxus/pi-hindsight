import { basename } from "node:path";
import type { ResolvedConfig, StatusStyle } from "./types.js";

export type HindsightActivity =
  | "idle"
  | "connected"
  | "offline"
  | "recalling"
  | "recalled"
  | "recall-empty"
  | "recall-failed"
  | "retaining"
  | "retained"
  | "retain-queued"
  | "retain-failed"
  | "importing"
  | "imported"
  | "import-queued"
  | "import-failed";

export interface HindsightStatusState {
  projectBankId: string;
  cwd: string;
  activity: HindsightActivity;
  memoryCount?: number;
  queueRemaining?: number;
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function shortProject(cwd: string, max: number): string {
  return truncate(basename(cwd) || "project", max);
}

function shortBank(bankId: string, max: number): string {
  return truncate(bankId.replace(/^pi-project-/, ""), max);
}

export function formatHindsightActivity(
  activity: HindsightActivity,
  memoryCount?: number,
  queueRemaining?: number,
): string {
  switch (activity) {
    case "connected":
      return "connected";
    case "offline":
      return "offline";
    case "recalling":
      return "recalling";
    case "recalled":
      return memoryCount !== undefined ? `recalled:${memoryCount}` : "recalled";
    case "recall-empty":
      return "no-memory";
    case "recall-failed":
      return "recall-failed";
    case "retaining":
      return "retaining";
    case "retained":
      return queueRemaining ? `queued:${queueRemaining}` : "retained";
    case "retain-queued":
      return queueRemaining !== undefined ? `queued:${queueRemaining}` : "queued";
    case "retain-failed":
      return "retain-failed";
    case "importing":
      return "importing";
    case "imported":
      return queueRemaining ? `imported+queued:${queueRemaining}` : "imported";
    case "import-queued":
      return queueRemaining !== undefined ? `import-queued:${queueRemaining}` : "import-queued";
    case "import-failed":
      return "import-failed";
    default:
      return "idle";
  }
}

function prefix(style: StatusStyle, activity: HindsightActivity): string {
  if (style === "emoji") {
    if (activity.includes("failed") || activity === "offline") return "🤯";
    return "🧠";
  }
  if (style === "nerdfont") {
    if (activity.includes("failed") || activity === "offline") return "󰧑";
    if (activity === "recalling" || activity === "recalled") return "󰑓";
    if (activity === "retaining" || activity === "retained") return "󰆓";
    if (activity === "importing" || activity === "imported" || activity === "import-queued")
      return "󰋺";
    return "󰍛";
  }
  return "mem";
}

export function formatHindsightStatus(
  config: ResolvedConfig,
  state: HindsightStatusState,
): string | undefined {
  const { style, detail, maxLength, showActivity } = config.status;
  if (style === "off") return undefined;
  const p = prefix(style, state.activity);
  const project = shortProject(state.cwd, Math.max(4, maxLength));
  const bank = shortBank(state.projectBankId, Math.max(8, maxLength));
  const activity = showActivity
    ? formatHindsightActivity(state.activity, state.memoryCount, state.queueRemaining)
    : "idle";

  let body: string;
  if (detail === "minimal") body = "";
  else if (detail === "project") body = bank;
  else if (detail === "activity") body = activity;
  else body = `${project}:${bank}:${activity}`;

  const separator = style === "text" ? ":" : " ";
  return truncate(body ? `${p}${separator}${body}` : p, maxLength);
}
