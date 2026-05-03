import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const generatorPath = resolve("scripts/generate-changelog.mjs");

const subprocessTimeoutMs = 10_000;

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd, timeout: subprocessTimeoutMs });
}

async function commit(cwd: string, message: string, date: string) {
  await execFileAsync("git", ["commit", "--allow-empty", "-m", message], {
    cwd,
    timeout: subprocessTimeoutMs,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: `${date}T00:00:00Z`,
      GIT_COMMITTER_DATE: `${date}T00:00:00Z`,
    },
  });
}

describe("generate-changelog", () => {
  it("is deterministic, skips merge commits, and groups conventional and squash subjects", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-changelog-"));
    try {
      await git(cwd, ["init"]);
      await git(cwd, ["config", "user.email", "test@example.com"]);
      await git(cwd, ["config", "user.name", "Test User"]);
      await git(cwd, ["checkout", "-b", "main"]);
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "example",
          version: "1.2.3",
          repository: { url: "git+https://example.test/repo.git" },
        }),
      );
      await git(cwd, ["add", "package.json"]);
      await commit(cwd, "feat: add memory", "2024-01-01");
      await commit(cwd, "Fix squash title", "2024-01-02");
      await git(cwd, ["checkout", "-b", "topic"]);
      await commit(cwd, "fix: repair queue", "2024-01-03");
      await git(cwd, ["checkout", "main"]);
      await git(cwd, ["merge", "--no-ff", "topic", "-m", "Merge pull request #1"]);

      await execFileAsync("node", [generatorPath], { cwd, timeout: subprocessTimeoutMs });
      const first = await readFile(join(cwd, "CHANGELOG.md"), "utf8");
      await execFileAsync("node", [generatorPath], { cwd, timeout: subprocessTimeoutMs });
      const second = await readFile(join(cwd, "CHANGELOG.md"), "utf8");

      expect(second).toBe(first);
      expect(first).toContain("## 1.2.3 (2024-01-03)");
      expect(first).toContain("### Features");
      expect(first).toContain("- add memory ([");
      expect(first).toContain("### Bug Fixes");
      expect(first).toContain("- repair queue ([");
      expect(first).toContain("### Other Changes");
      expect(first).toContain("- Fix squash title ([");
      expect(first).not.toContain("Merge pull request #1");
      expect(first).toContain("https://example.test/repo/commit/");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 20_000);
});
