import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
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

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

export function findRepoRoot(cwd: string): string {
  const gitRoot = findMainGitWorktreeRoot(cwd);
  if (gitRoot) return canonicalPath(gitRoot);

  let current = resolve(cwd);
  while (true) {
    if (existsSync(`${current}/.git`)) return canonicalPath(current);
    const parent = resolve(current, "..");
    if (parent === current) return canonicalPath(cwd);
    current = parent;
  }
}

function findMainGitWorktreeRoot(cwd: string): string | undefined {
  try {
    const git = (args: string[]) =>
      execFileSync("git", ["rev-parse", "--path-format=absolute", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      }).trim();

    const commonDir = git(["--git-common-dir"]);
    if (!commonDir) return undefined;
    const gitDir = git(["--git-dir"]);

    if (commonDir !== gitDir && basename(commonDir) === ".git") return dirname(commonDir);

    const topLevel = git(["--show-toplevel"]);
    return topLevel || (basename(commonDir) === ".git" ? dirname(commonDir) : commonDir);
  } catch {
    return undefined;
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
