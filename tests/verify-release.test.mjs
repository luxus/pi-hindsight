import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve("scripts/verify-release.mjs");

async function repo(version, changelog) {
  const dir = await mkdtemp(join(tmpdir(), "verify-release-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ version }), "utf8");
  await writeFile(join(dir, "CHANGELOG.md"), changelog, "utf8");
  return dir;
}

describe("verify-release", () => {
  it("accepts exact changelog version heading", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(execFileAsync("node", [script], { cwd })).resolves.toMatchObject({
      stdout: expect.stringContaining('"version":"1.2.3"'),
    });
  });

  it("rejects substring changelog version heading", async () => {
    const cwd = await repo("1.2.3", "## [11.2.3] - 2026-01-01\n");
    await expect(execFileAsync("node", [script], { cwd })).rejects.toMatchObject({
      stderr: expect.stringContaining("CHANGELOG.md missing release heading for 1.2.3"),
    });
  });

  it("rejects mismatched tag version", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(
      execFileAsync("node", [script], { cwd, env: { ...process.env, GITHUB_REF_NAME: "v1.2.4" } }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Release tag v1.2.4 does not match package.json version 1.2.3",
      ),
    });
  });
});
