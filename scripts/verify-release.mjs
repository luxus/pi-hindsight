#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version;
if (!version) throw new Error("package.json missing version");

const refName = process.env.GITHUB_REF_NAME;
const refType = process.env.GITHUB_REF_TYPE;
const expectedTag = `v${version}`;
if (refName && (refType === "tag" || refName.startsWith("v"))) {
  if (refName !== expectedTag) {
    throw new Error(
      `Release tag ${refName} does not match package.json version ${version} (expected ${expectedTag})`,
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const changelog = await readFile("CHANGELOG.md", "utf8");
const escapedVersion = escapeRegExp(version);
const versionHeading = new RegExp(
  `^## (?:${escapedVersion}|\\[${escapedVersion}\\](?:\\([^\\r\\n)]*\\))?)(?:\\s|$)`,
  "m",
);
if (!versionHeading.test(changelog)) {
  throw new Error(`CHANGELOG.md missing release heading for ${version}`);
}

console.log(JSON.stringify({ ok: true, version, refName: refName ?? null }));
