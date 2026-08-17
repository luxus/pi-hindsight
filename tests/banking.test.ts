import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExecFileSyncOptions } from "node:child_process";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  baseTags,
  deriveProjectBankId,
  findRepoRoot,
  recallScopeTags,
} from "../extensions/banks/banking.js";
import { liveDocumentId, stableSessionId } from "../extensions/utils/session.js";

const LOCAL_GIT_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_DIR",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_GRAFT_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
] as const;

function isolatedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const key of LOCAL_GIT_ENV_KEYS) delete env[key];
  return env;
}

function withoutLocalGitEnv<T>(fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of LOCAL_GIT_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of LOCAL_GIT_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function git(args: string[], cwd: string, home: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: isolatedGitEnv({ HOME: home, GIT_CONFIG_NOSYSTEM: "1" }),
  } satisfies ExecFileSyncOptions);
}

describe("banking/session identity", () => {
  it("derives stable project bank from repo root", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hindsight-repo-"));
    mkdirSync(join(root, ".git"));
    const child = join(root, "a", "b");
    mkdirSync(child, { recursive: true });
    withoutLocalGitEnv(() => {
      expect(findRepoRoot(child)).toBe(realpathSync.native(root));
      expect(deriveProjectBankId(child, DEFAULT_CONFIG)).toBe(
        deriveProjectBankId(root, DEFAULT_CONFIG),
      );
    });
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

    withoutLocalGitEnv(() => {
      expect(findRepoRoot(linked)).toBe(realpathSync.native(main));
      expect(deriveProjectBankId(linked, DEFAULT_CONFIG)).toBe(
        deriveProjectBankId(main, DEFAULT_CONFIG),
      );
      expect(recallScopeTags(linked)).toEqual(recallScopeTags(main));
    });
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

    withoutLocalGitEnv(() => {
      expect(findRepoRoot(submodule)).toBe(realpathSync.native(submodule));
      expect(deriveProjectBankId(submodule, DEFAULT_CONFIG)).not.toBe(
        deriveProjectBankId(superProject, DEFAULT_CONFIG),
      );
    });
  }, 15_000);

  it("uses stable live document ids", () => {
    expect(liveDocumentId("/tmp/session.jsonl", "/repo")).toBe(
      liveDocumentId("/tmp/session.jsonl", "/repo"),
    );
    expect(baseTags("/repo", "s1")).toContain("session:s1");
    expect(baseTags("/repo", "s1")).toEqual(
      expect.arrayContaining([
        "source:pi",
        "harness:pi",
        expect.stringMatching(/^project:/),
        expect.stringMatching(/^repo:/),
        "session:s1",
      ]),
    );
    expect(recallScopeTags("/repo")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^project:/), expect.stringMatching(/^repo:/)]),
    );
  });

  it("separates missing-session-file identities from cwd-only repo identity", () => {
    const first = stableSessionId(undefined, "/repo");
    const second = stableSessionId(undefined, "/repo");

    expect(first).toBe(second);
    expect(first).not.toBe(stableSessionId("ephemeral:/repo", "/repo"));
  });
});

describe("domain coding bank roles", () => {
  it("uses explicit coding bank id for domain-tagged mode", async () => {
    const { deriveProjectBankId } = await import("../extensions/banks/banking.js");
    const { DEFAULT_CONFIG } = await import("../extensions/config/config.js");
    const config = {
      ...DEFAULT_CONFIG,
      scope: { ...DEFAULT_CONFIG.scope, mode: "domain-tagged" as const },
      banks: {
        ...DEFAULT_CONFIG.banks,
        project: { enabled: true, bankId: "kai-coding", derive: "manual" as const },
      },
    };
    expect(deriveProjectBankId("/any/repo", config)).toBe("kai-coding");
    expect(deriveProjectBankId("/other/repo", config)).toBe("kai-coding");
  });

  it("uses the git-root folder name when derive is basename", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-basename-"));
    const root = join(parent, "my_websites");
    mkdirSync(root);
    mkdirSync(join(root, ".git"));
    const child = join(root, "apps", "web");
    mkdirSync(child, { recursive: true });
    const config = {
      ...DEFAULT_CONFIG,
      scope: { ...DEFAULT_CONFIG.scope, mode: "isolated-bank" as const },
      banks: {
        ...DEFAULT_CONFIG.banks,
        project: { enabled: true, derive: "basename" as const },
      },
    };
    withoutLocalGitEnv(() => {
      expect(deriveProjectBankId(child, config)).toBe("my_websites");
      expect(deriveProjectBankId(root, config)).toBe("my_websites");
    });
  });

  it("keeps hashed bank ids for the default repo derive", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-hindsight-hashed-"));
    const root = join(parent, "my_websites");
    mkdirSync(root);
    mkdirSync(join(root, ".git"));
    withoutLocalGitEnv(() => {
      expect(deriveProjectBankId(root, DEFAULT_CONFIG)).toMatch(
        /^pi-project-my-websites-[0-9a-f]{12}$/,
      );
    });
  });
});
