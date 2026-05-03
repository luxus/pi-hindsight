#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  const cwd = process.cwd();
  const pack = await execFileAsync("npm", ["pack", "--json"], { cwd });
  const [entry] = JSON.parse(pack.stdout);
  if (!entry?.filename) throw new Error("npm pack did not return a tarball filename");
  const tarball = join(cwd, entry.filename);
  const dir = await mkdtemp(join(tmpdir(), "pi-hindsight-install-smoke-"));
  try {
    await execFileAsync("npm", ["init", "-y"], { cwd: dir });
    await execFileAsync("npm", ["install", tarball, "--ignore-scripts"], { cwd: dir });
    const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    const packagePath = String(packageJson.name).split("/");
    const installed = JSON.parse(
      await readFile(join(dir, "node_modules", ...packagePath, "package.json"), "utf8"),
    );
    if (!installed.pi?.extensions?.includes("./extensions")) {
      throw new Error("installed package missing pi.extensions entry");
    }
    await readFile(join(dir, "node_modules", ...packagePath, "extensions", "index.ts"), "utf8");
    console.log(JSON.stringify({ ok: true, package: installed.name, version: installed.version }));
  } finally {
    await rm(tarball, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
