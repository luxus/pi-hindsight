import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../types.js";

/**
 * Whether automatic Hindsight network memory (ensure bank, auto-recall, auto-retain)
 * is allowed. False on a true first run until guided/agent setup or explicit bank ids.
 * Existing installs migrate via bank ids, config files, or local runtime state (ADR-005).
 *
 * Domain-tagged + project bank enabled additionally requires an explicit coding bankId
 * so we never auto-operate on a path-derived bank as if it were a shared coding domain.
 * isolated-bank may still path-derive.
 */
export function isMemorySetupComplete(config: ResolvedConfig, cwd: string): boolean {
  if (!hasSetupSignals(config, cwd)) return false;
  if (requiresExplicitCodingBankId(config) && !config.banks.project.bankId?.trim()) {
    return false;
  }
  return true;
}

/** Soft signals that this install is not a pure first-run blank slate. */
function hasSetupSignals(config: ResolvedConfig, cwd: string): boolean {
  if (config.setupComplete === true) return true;
  if (config.banks.project.bankId?.trim()) return true;
  if (config.banks.user.bankId?.trim()) return true;
  if (config.banks.global.bankId?.trim()) return true;
  if (hasProjectConfigFile(cwd)) return true;
  if (hasLocalRuntimeState(cwd, config)) return true;
  return false;
}

/**
 * Domain-tagged coding path needs a real shared bank id before auto network I/O.
 * isolated-bank (hard wall) may keep path-derived identity.
 */
export function requiresExplicitCodingBankId(config: ResolvedConfig): boolean {
  return config.scope.mode === "domain-tagged" && config.banks.project.enabled;
}

const DOCS_BASE_URL = "https://luxus.github.io/pi-hindsight";
const CHANGELOG_URL = "https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md";

/**
 * Startup / status hint when automatic memory is blocked by the setup gate.
 * Keep scannable: primary action first, durable opt-out visible, docs last.
 */
export function setupRequiredMessage(): string {
  return [
    "Hindsight setup required — automatic memory is off until this repo is configured.",
    "",
    "Start here: run  /hindsight",
    "  • Guided setup — pick a profile, bank IDs, optional mental models / import",
    "  • Ignore this repo — durable opt-out (no auto memory, tools, or status bar)",
    "  • Skip for now — dismiss only; this warning can return next session",
    "",
    "Or set banks.project.bankId (or PI_HINDSIGHT_PROJECT_BANK_ID).",
    "Domain-tagged mode needs an explicit coding bank id; isolated-bank may path-derive.",
    "",
    `Docs: ${DOCS_BASE_URL}/start/setup-tui/`,
    `Upgrade: ${DOCS_BASE_URL}/guides/upgrading-to-domain-banks/`,
    `Identity: ${DOCS_BASE_URL}/concepts/project-identity/`,
    `Changelog: ${CHANGELOG_URL}`,
  ].join("\n");
}

function hasProjectConfigFile(cwd: string): boolean {
  return (
    existsSync(join(cwd, ".pi", "hindsight.json")) ||
    existsSync(join(cwd, ".pi", "hindsight.jsonc"))
  );
}

function hasLocalRuntimeState(cwd: string, config: ResolvedConfig): boolean {
  const dir = join(cwd, ".pi", "hindsight");
  if (!existsSync(dir)) return false;
  const candidates = [
    join(cwd, config.retain.queuePath),
    join(cwd, config.retain.queuePath.replace(/\.jsonl$/, ".dead.jsonl")),
    join(cwd, ".pi", "hindsight", "retain-cursors.json"),
    join(cwd, config.import.manifestPath),
    join(cwd, config.import.checkpointPath),
    join(cwd, config.recall.lastRecallPath),
  ];
  return candidates.some((path) => existsSync(path));
}
