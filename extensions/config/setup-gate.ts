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

export function setupRequiredMessage(): string {
  return (
    "Hindsight setup required: run /hindsight guided setup, or set banks.project.bankId " +
    "(or PI_HINDSIGHT_PROJECT_BANK_ID). Domain-tagged mode needs an explicit coding bank id " +
    "before automatic memory network I/O. Isolated-bank may path-derive."
  );
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
