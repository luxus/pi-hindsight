import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve("scripts/verify-release.mjs");
const releasePleaseConfig = resolve(".release-please-config.json");
const releaseWorkflow = resolve(".github/workflows/release.yml");
const releasePleaseWorkflow = resolve(".github/workflows/release-please.yml");
const testEnv = { ...process.env, GITHUB_REF_NAME: "", GITHUB_REF_TYPE: "" };

async function repo(version, changelog) {
  const dir = await mkdtemp(join(tmpdir(), "verify-release-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ version }), "utf8");
  await writeFile(join(dir, "CHANGELOG.md"), changelog, "utf8");
  return dir;
}

describe("verify-release", () => {
  it("accepts exact changelog version heading", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(execFileAsync("node", [script], { cwd, env: testEnv })).resolves.toMatchObject({
      stdout: expect.stringContaining('"version":"1.2.3"'),
    });
  });

  it("accepts release-please linked changelog version heading", async () => {
    const cwd = await repo(
      "1.2.3",
      "## [1.2.3](https://github.com/luxus/pi-hindsight/compare/pi-hindsight-v1.2.2...pi-hindsight-v1.2.3) (2026-01-01)\n",
    );
    await expect(execFileAsync("node", [script], { cwd, env: testEnv })).resolves.toMatchObject({
      stdout: expect.stringContaining('"version":"1.2.3"'),
    });
  });

  it("rejects substring changelog version heading", async () => {
    const cwd = await repo("1.2.3", "## [11.2.3] - 2026-01-01\n");
    await expect(execFileAsync("node", [script], { cwd, env: testEnv })).rejects.toMatchObject({
      stderr: expect.stringContaining("CHANGELOG.md missing release heading for 1.2.3"),
    });
  });

  it("accepts matching v tag version", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(
      execFileAsync("node", [script], {
        cwd,
        env: { ...testEnv, GITHUB_REF_NAME: "v1.2.3", GITHUB_REF_TYPE: "tag" },
      }),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining('"refName":"v1.2.3"'),
    });
  });

  it("rejects mismatched tag version", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(
      execFileAsync("node", [script], { cwd, env: { ...testEnv, GITHUB_REF_NAME: "v1.2.4" } }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Release tag v1.2.4 does not match package.json version 1.2.3",
      ),
    });
  });

  it("rejects release-please component tag namespace for tag refs", async () => {
    const cwd = await repo("1.2.3", "## [1.2.3] - 2026-01-01\n");
    await expect(
      execFileAsync("node", [script], {
        cwd,
        env: { ...testEnv, GITHUB_REF_NAME: "pi-hindsight-v1.2.3", GITHUB_REF_TYPE: "tag" },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("expected v1.2.3"),
    });
  });

  it("keeps release-please publishing aligned with npm trusted publishing", async () => {
    const config = JSON.parse(await readFile(releasePleaseConfig, "utf8"));
    const release = await readFile(releaseWorkflow, "utf8");
    const releasePlease = await readFile(releasePleaseWorkflow, "utf8");

    expect(config.packages["."]["package-name"]).toBe("@luxusai/pi-hindsight");
    expect(config.packages["."]["include-component-in-tag"]).toBe(false);
    expect(releasePlease).toContain("id-token: write");
    expect(releasePlease).toContain("steps.release.outputs.release_created == 'true'");
    expect(releasePlease).toContain("npm publish --provenance --access public");
    expect(release).not.toContain("npm publish");
    expect(releasePlease).not.toContain("pi-hindsight-v");
  });
});
