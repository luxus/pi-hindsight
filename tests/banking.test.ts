import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExecFileSyncOptions } from "node:child_process";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  baseTags,
  deriveProjectBankId,
  findRepoRoot,
  recallScopeTags,
} from "../extensions/banking.js";
import { liveDocumentId, stableSessionId } from "../extensions/session.js";

function git(args: string[], cwd: string, home: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" },
  } satisfies ExecFileSyncOptions);
}

describe("banking/session identity", () => {
  it("derives stable project bank from repo root", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-repo-"));
    mkdirSync(join(root, ".git"));
    const child = join(root, "a", "b");
    mkdirSync(child, { recursive: true });
    expect(findRepoRoot(child)).toBe(realpathSync.native(root));
    expect(deriveProjectBankId(child, DEFAULT_CONFIG)).toBe(
      deriveProjectBankId(root, DEFAULT_CONFIG),
    );
  });

  it("shares project identity across git linked worktrees", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-worktrees-"));
    const main = join(parent, "main-repo");
    const linked = join(realpathSync.native(parent), "feature-worktree");
    const home = join(parent, "home");
    mkdirSync(home);

    git(["init", main], parent, home);
    git(["config", "user.email", "pi@example.invalid"], main, home);
    git(["config", "user.name", "Pi Test"], main, home);
    git(["commit", "--allow-empty", "-m", "init"], main, home);

    const linkedGitDir = join(realpathSync.native(main), ".git", "worktrees", "feature-worktree");
    mkdirSync(linked, { recursive: true });
    mkdirSync(linkedGitDir, { recursive: true });
    writeFileSync(join(linked, ".git"), `gitdir: ${linkedGitDir}\n`);
    writeFileSync(join(linkedGitDir, "gitdir"), `${join(linked, ".git")}\n`);
    writeFileSync(join(linkedGitDir, "commondir"), "../..\n");
    copyFileSync(join(realpathSync.native(main), ".git", "HEAD"), join(linkedGitDir, "HEAD"));
    writeFileSync(join(linkedGitDir, "index"), "");

    expect(findRepoRoot(linked)).toBe(realpathSync.native(main));
    expect(deriveProjectBankId(linked, DEFAULT_CONFIG)).toBe(
      deriveProjectBankId(main, DEFAULT_CONFIG),
    );
    expect(recallScopeTags(linked)).toEqual(recallScopeTags(main));
  }, 15_000);

  it("uses the submodule worktree root instead of superproject git storage", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-submodule-"));
    const subSource = join(parent, "sub-source");
    const superProject = join(parent, "super");
    const submodule = join(superProject, "deps", "sub");
    const home = join(parent, "home");
    mkdirSync(home);

    git(["init", subSource], parent, home);
    git(["config", "user.email", "pi@example.invalid"], subSource, home);
    git(["config", "user.name", "Pi Test"], subSource, home);
    git(["commit", "--allow-empty", "-m", "init-sub"], subSource, home);

    git(["init", superProject], parent, home);
    git(["config", "user.email", "pi@example.invalid"], superProject, home);
    git(["config", "user.name", "Pi Test"], superProject, home);
    mkdirSync(join(superProject, "deps"), { recursive: true });
    git(
      [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        realpathSync.native(subSource),
        "deps/sub",
      ],
      realpathSync.native(superProject),
      home,
    );

    expect(findRepoRoot(submodule)).toBe(realpathSync.native(submodule));
    expect(deriveProjectBankId(submodule, DEFAULT_CONFIG)).not.toBe(
      deriveProjectBankId(superProject, DEFAULT_CONFIG),
    );
  }, 15_000);

  it("uses stable live document ids", () => {
    expect(liveDocumentId("/tmp/session.jsonl", "/repo")).toBe(
      liveDocumentId("/tmp/session.jsonl", "/repo"),
    );
    expect(baseTags("/repo", "s1")).toContain("session:s1");
    expect(recallScopeTags("/repo")).toEqual([expect.stringMatching(/^repo:/)]);
  });

  it("separates missing-session-file identities from cwd-only repo identity", () => {
    const first = stableSessionId(undefined, "/repo");
    const second = stableSessionId(undefined, "/repo");

    expect(first).toBe(second);
    expect(first).not.toBe(stableSessionId("ephemeral:/repo", "/repo"));
  });
});
