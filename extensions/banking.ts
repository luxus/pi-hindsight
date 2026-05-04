import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { BankSelection, ResolvedConfig } from "./types.js";

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "repo"
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function findRepoRoot(cwd: string): string {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(`${current}/.git`)) return current;
    const parent = resolve(current, "..");
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export function repoKey(cwd: string): string {
  const root = findRepoRoot(cwd);
  return `${slug(basename(root))}-${hash(root)}`;
}

export function deriveProjectBankId(cwd: string, config: ResolvedConfig): string {
  if (config.banks.project.bankId) return config.banks.project.bankId;
  const basis = config.banks.project.derive === "cwd" ? resolve(cwd) : findRepoRoot(cwd);
  return `pi-project-${slug(basename(basis))}-${hash(basis)}`;
}

export function selectBanks(cwd: string, config: ResolvedConfig): BankSelection {
  const globalBankId = config.banks.user.enabled ? config.banks.user.bankId : undefined;
  return {
    projectBankId: deriveProjectBankId(cwd, config),
    ...(globalBankId ? { globalBankId } : {}),
  };
}

export function baseTags(cwd: string, sessionId: string, leafId?: string): string[] {
  const tags = ["source:pi", `repo:${repoKey(cwd)}`, `session:${sessionId}`];
  if (leafId) tags.push(`branch:${leafId}`);
  return tags;
}

export function recallScopeTags(cwd: string): string[] {
  return [`repo:${repoKey(cwd)}`];
}
