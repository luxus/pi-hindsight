import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  normalizeGitRemoteToProjectId,
  recallScopeTags,
  resolveProjectIdentity,
} from "../extensions/banks/banking.js";
import type { ResolvedConfig, ScopeConfig } from "../extensions/types.js";

function config(
  patch: Partial<Omit<ResolvedConfig, "scope">> & { scope?: Partial<ScopeConfig> } = {},
): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    scope: { ...DEFAULT_CONFIG.scope, ...patch.scope },
  };
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  });
}

describe("stable project identity", () => {
  it("normalizes git remotes into stable project ids", () => {
    expect(normalizeGitRemoteToProjectId("git@github.com:luxus/finalform.git")).toBe(
      "github-com-luxus-finalform",
    );
    expect(normalizeGitRemoteToProjectId("https://github.com/luxus/finalform.git")).toBe(
      "github-com-luxus-finalform",
    );
    expect(normalizeGitRemoteToProjectId("https://github.com/luxus/finalform")).toBe(
      "github-com-luxus-finalform",
    );
  });

  it("prefers an explicit pin over remote and basename", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-pin-"));
    mkdirSync(join(cwd, ".git"));
    const identity = resolveProjectIdentity(
      cwd,
      config({ scope: { projectId: "FinalForm!", projectIdStrategy: "remote" } }),
    );
    expect(identity.basis).toBe("pin");
    expect(identity.projectId).toBe("finalform");
  });

  it("uses git remote when strategy is remote and origin exists", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-remote-"));
    const repo = join(parent, "my-app");
    mkdirSync(repo);
    git(["init"], repo);
    git(["remote", "add", "origin", "git@github.com:luxus/my-app.git"], repo);
    const identity = resolveProjectIdentity(repo, config());
    expect(identity.basis).toBe("remote");
    expect(identity.projectId).toBe("github-com-luxus-my-app");
    const tags = recallScopeTags(repo, config());
    expect(tags).toEqual(
      expect.arrayContaining([
        "project:github-com-luxus-my-app",
        expect.stringMatching(/^repo:my-app-/),
      ]),
    );
  }, 15_000);

  it("falls back to basename when remote strategy has no origin", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-base-"));
    const repo = join(cwd, "solo-repo");
    mkdirSync(repo);
    git(["init"], repo);
    const identity = resolveProjectIdentity(repo, config());
    expect(identity.basis).toBe("basename");
    expect(identity.projectId).toBe("solo-repo");
  }, 15_000);

  it("uses basename strategy when configured even if remote exists", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-base-strat-"));
    const repo = join(parent, "named-folder");
    mkdirSync(repo);
    git(["init"], repo);
    git(["remote", "add", "origin", "git@github.com:luxus/other.git"], repo);
    const identity = resolveProjectIdentity(
      repo,
      config({ scope: { projectIdStrategy: "basename" } }),
    );
    expect(identity.basis).toBe("basename");
    expect(identity.projectId).toBe("named-folder");
  }, 15_000);
});
