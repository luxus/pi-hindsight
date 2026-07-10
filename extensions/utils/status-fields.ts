import { isMemorySetupComplete } from "../config/setup-gate.js";
import { DEFAULT_CONFIG } from "../config/config-defaults.js";
import { formatProjectIdentityForStatus, resolveProjectIdentity } from "../banks/banking.js";
import type { ResolvedConfig } from "../types.js";

export type StatusFieldTone = "default" | "custom" | "warn" | "info";

export interface StatusField {
  key: string;
  label: string;
  value: string;
  tone: StatusFieldTone;
  source?: string;
}

export interface StatusFieldContext {
  cwd: string;
  projectBankId: string;
  queueLength?: number;
  deadLetterLength?: number;
  healthOk?: boolean;
  healthError?: string;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build read-only status fields with tone vs defaults (ADR-005).
 * warn = broken/setup incomplete; custom = non-default valid; info = intentionally off; default = quiet.
 */
export function buildStatusFields(config: ResolvedConfig, ctx: StatusFieldContext): StatusField[] {
  const fields: StatusField[] = [];
  const setupOk = isMemorySetupComplete(config, ctx.cwd);
  const project = resolveProjectIdentity(ctx.cwd, config);

  fields.push({
    key: "setup",
    label: "Setup",
    value: setupOk ? "complete" : "required",
    tone: setupOk ? "default" : "warn",
  });

  fields.push({
    key: "enabled",
    label: "Extension",
    value: config.enabled ? "enabled" : "disabled",
    tone:
      config.enabled === DEFAULT_CONFIG.enabled ? "default" : config.enabled ? "custom" : "info",
  });

  fields.push({
    key: "baseUrl",
    label: "Hindsight URL",
    value: config.hindsight.baseUrl,
    tone: config.hindsight.baseUrl === DEFAULT_CONFIG.hindsight.baseUrl ? "default" : "custom",
  });

  if (ctx.healthOk === false) {
    fields.push({
      key: "health",
      label: "Server",
      value: ctx.healthError ? `unreachable: ${ctx.healthError}` : "unreachable",
      tone: "warn",
    });
  } else if (ctx.healthOk === true) {
    fields.push({ key: "health", label: "Server", value: "reachable", tone: "default" });
  }

  fields.push({
    key: "scopeMode",
    label: "Scope mode",
    value: config.scope.mode,
    tone: config.scope.mode === DEFAULT_CONFIG.scope.mode ? "default" : "custom",
  });

  fields.push({
    key: "sharedObservations",
    label: "Shared observations",
    value: config.scope.includeSharedObservations ? "include (opt-in)" : "strict project only",
    tone: config.scope.includeSharedObservations ? "custom" : "default",
  });

  fields.push({
    key: "projectScope",
    label: "Project scope",
    value: formatProjectIdentityForStatus(project),
    tone: project.basis === "pin" ? "custom" : "default",
  });

  const codingEnabled = config.banks.project.enabled;
  fields.push({
    key: "codingBank",
    label: "Coding bank",
    value: codingEnabled
      ? `${ctx.projectBankId}${config.banks.project.bankId ? "" : " (path-derived)"}`
      : "disabled",
    tone: !codingEnabled
      ? "info"
      : config.banks.project.bankId
        ? "custom"
        : setupOk
          ? "warn"
          : "info",
  });

  const lifeId = config.banks.user.bankId;
  fields.push({
    key: "lifeBank",
    label: "Life bank",
    value: config.banks.user.enabled ? (lifeId ?? "(no bankId)") : "disabled",
    tone: !config.banks.user.enabled ? "info" : lifeId ? "custom" : "warn",
  });

  fields.push({
    key: "recall",
    label: "Auto recall",
    value: config.recall.enabled ? "on" : "off",
    tone: config.recall.enabled === DEFAULT_CONFIG.recall.enabled ? "default" : "custom",
  });

  fields.push({
    key: "retain",
    label: "Auto retain",
    value: config.retain.enabled ? "on" : "off",
    tone: config.retain.enabled === DEFAULT_CONFIG.retain.enabled ? "default" : "custom",
  });

  if (!eq(config.recall.maxTokens, DEFAULT_CONFIG.recall.maxTokens)) {
    fields.push({
      key: "recallMaxTokens",
      label: "Recall maxTokens",
      value: String(config.recall.maxTokens),
      tone: "custom",
    });
  }

  const queue = ctx.queueLength ?? 0;
  const dead = ctx.deadLetterLength ?? 0;
  fields.push({
    key: "queue",
    label: "Retain queue",
    value: dead > 0 ? `${queue} pending, ${dead} dead-letter` : `${queue} pending`,
    tone: dead > 0 ? "warn" : queue > 0 ? "custom" : "default",
  });

  fields.push({
    key: "mentalModels",
    label: "Mental model inject",
    value: config.mentalModels.inject ? "on" : "off",
    tone: config.mentalModels.inject === DEFAULT_CONFIG.mentalModels.inject ? "default" : "custom",
  });

  return fields;
}

/** Render fields for TUI/doctor text (tone as marker; color is TUI's job). */
export function formatStatusFieldsText(fields: StatusField[]): string {
  return fields
    .map((f) => {
      const mark =
        f.tone === "warn" ? "!" : f.tone === "custom" ? "*" : f.tone === "info" ? "-" : " ";
      return `${mark} ${f.label}: ${f.value}`;
    })
    .join("\n");
}
