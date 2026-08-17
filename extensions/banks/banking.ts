import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import type { BankSelection, ResolvedConfig } from "../types.js";

export type ProjectIdBasis = "pin" | "remote" | "basename";

export interface ProjectIdentity {
  /** Stable project id used in `project:<id>` tags. */
  projectId: string;
  basis: ProjectIdBasis;
  /** Human-readable source (pin value, remote URL, or root path). */
  source: string;
  /** Absolute-path-hash legacy key (for dual-tag / migration diagnostics). */
  legacyRepoKey: string;
}

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

/** Path-hash legacy identity (Mac/Linux path moves change this). Prefer projectId. */
export function legacyRepoKey(cwd: string): string {
  const root = findRepoRoot(cwd);
  return `${slug(basename(root))}-${hash(root)}`;
}

/** @deprecated Use resolveProjectIdentity / projectId; kept for call-site compatibility. */
export function repoKey(cwd: string): string {
  return legacyRepoKey(cwd);
}

export function normalizeGitRemoteToProjectId(remoteUrl: string): string {
  let value = remoteUrl.trim();
  const scp = value.match(/^git@([^:]+):(.+)$/i);
  if (scp) value = `${scp[1]}/${scp[2]}`;
  value = value
    // Drop userinfo (tokens/credentials) before slugging so insteadOf/helper URLs
    // cannot leak into stable project:<id> tags.
    .replace(/^(https?:\/\/)[^/@]+@/i, "$1")
    .replace(/^https?:\/\//i, "")
    .replace(/^ssh:\/\/git@/i, "")
    .replace(/^git:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+/g, "/");
  const id = slug(value);
  return id || "remote";
}

function gitRemoteOrigin(repoRoot: string): string | undefined {
  try {
    // Read the configured URL, not `git remote get-url`, so url.*.insteadOf
    // credential rewrites (CI/cloud agents) do not change project identity.
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve stable project identity: pin → git remote (default) → basename.
 * Survives absolute path moves when a remote or pin is available (ADR-005).
 */
export function resolveProjectIdentity(cwd: string, config: ResolvedConfig): ProjectIdentity {
  const root = findRepoRoot(cwd);
  const legacy = `${slug(basename(root))}-${hash(root)}`;
  const pin = config.scope?.projectId?.trim();
  if (pin) {
    return {
      projectId: slug(pin) || pin,
      basis: "pin",
      source: pin,
      legacyRepoKey: legacy,
    };
  }

  const strategy = config.scope?.projectIdStrategy ?? "remote";
  if (strategy === "remote") {
    const remote = gitRemoteOrigin(root);
    if (remote) {
      return {
        projectId: normalizeGitRemoteToProjectId(remote),
        basis: "remote",
        source: remote,
        legacyRepoKey: legacy,
      };
    }
  }

  const base = slug(basename(root)) || "project";
  return {
    projectId: base,
    basis: "basename",
    source: root,
    legacyRepoKey: legacy,
  };
}

export function projectScopeTag(projectId: string): string {
  return `project:${projectId}`;
}

export function legacyRepoScopeTag(legacyKey: string): string {
  return `repo:${legacyKey}`;
}

/** Folder name as Claude/Grok dynamic project banks use it (no slug, keep underscores). */
export function folderBankId(path: string): string {
  return basename(path).trim() || "default";
}

/**
 * Resolve the coding-role bank id.
 * - Explicit banks.project.bankId always wins (domain coding bank or isolated override).
 * - isolated-bank mode (or legacy path when no bankId): path/cwd-derived bank.
 * - domain-tagged without bankId: still path-derived for upgrade safety; setup should set bankId.
 * - derive "basename": git-root folder name so Pi shares banks with Claude/Grok.
 */
export function deriveProjectBankId(cwd: string, config: ResolvedConfig): string {
  if (config.banks.project.bankId) return config.banks.project.bankId;
  // Domain-tagged + explicit bankId is the preferred shared coding bank path.
  // Without bankId, keep path-derived identity so upgrades do not silently merge banks.
  const basis = config.banks.project.derive === "cwd" ? resolve(cwd) : findRepoRoot(cwd);
  if (config.banks.project.derive === "basename") return folderBankId(basis);
  return `pi-project-${slug(basename(basis))}-${hash(basis)}`;
}

/** True when this repo uses a hard-isolated bank rather than a shared coding domain bank. */
export function isIsolatedBankMode(config: ResolvedConfig): boolean {
  return config.scope.mode === "isolated-bank";
}

/** Coding-role bank id (alias for deriveProjectBankId). */
export function deriveCodingBankId(cwd: string, config: ResolvedConfig): string {
  return deriveProjectBankId(cwd, config);
}

export function selectBanks(cwd: string, config: ResolvedConfig): BankSelection {
  const globalBankId = config.banks.user.enabled ? config.banks.user.bankId : undefined;
  return {
    projectBankId: deriveProjectBankId(cwd, config),
    ...(globalBankId ? { globalBankId } : {}),
  };
}

export function baseTags(
  cwd: string,
  sessionId: string,
  leafIdOrConfig?: string | ResolvedConfig,
  maybeConfig?: ResolvedConfig,
): string[] {
  const leafId = typeof leafIdOrConfig === "string" ? leafIdOrConfig : undefined;
  const config =
    typeof leafIdOrConfig === "object" && leafIdOrConfig
      ? leafIdOrConfig
      : (maybeConfig ??
        ({
          scope: { projectIdStrategy: "remote" },
        } as ResolvedConfig));
  const identity = resolveProjectIdentity(cwd, config);
  const tags = [
    "source:pi",
    // Provenance host tag (coding-agents uses harness:<name> + source:chat).
    "harness:pi",
    projectScopeTag(identity.projectId),
    // Dual-tag window: keep legacy path-hash tag so older memories still match any_strict.
    legacyRepoScopeTag(identity.legacyRepoKey),
    `session:${sessionId}`,
  ];
  if (leafId) tags.push(`branch:${leafId}`);
  return tags;
}

/** Project recall filter: match either stable project tag or legacy path-hash repo tag. */
export function recallScopeTags(cwd: string, config?: ResolvedConfig): string[] {
  const identity = resolveProjectIdentity(
    cwd,
    config ?? ({ scope: { projectIdStrategy: "remote" } } as ResolvedConfig),
  );
  return [projectScopeTag(identity.projectId), legacyRepoScopeTag(identity.legacyRepoKey)];
}

export function formatProjectIdentityForStatus(identity: ProjectIdentity): string {
  return `project:${identity.projectId} (from ${identity.basis}: ${identity.source})`;
}
