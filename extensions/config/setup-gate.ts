import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../types.js";

/**
 * Whether automatic Hindsight network memory (ensure bank, auto-recall, auto-retain)
 * is allowed. False on a true first run until guided/agent setup or explicit bank ids.
 * Existing installs migrate via bank ids, config files, or local runtime state (ADR-005).
 */
export function isMemorySetupComplete(config: ResolvedConfig, cwd: string): boolean {
  if (config.setupComplete === true) return true;
  if (config.banks.project.bankId?.trim()) return true;
  if (config.banks.user.bankId?.trim()) return true;
  if (config.banks.global.bankId?.trim()) return true;
  if (hasProjectConfigFile(cwd)) return true;
  if (hasLocalRuntimeState(cwd, config)) return true;
  return false;
}

export function setupRequiredMessage(): string {
  return (
    "Hindsight setup required: run /hindsight guided setup, or set banks.project.bankId " +
    "(or PI_HINDSIGHT_PROJECT_BANK_ID). Memory network I/O is paused until then."
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
