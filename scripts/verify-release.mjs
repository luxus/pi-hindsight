#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version;
if (!version) throw new Error("package.json missing version");

const refName = process.env.GITHUB_REF_NAME;
if (refName?.startsWith("v")) {
  const tagVersion = refName.slice(1);
  if (tagVersion !== version) {
    throw new Error(`Release tag ${refName} does not match package.json version ${version}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const changelog = await readFile("CHANGELOG.md", "utf8");
const escapedVersion = escapeRegExp(version);
const versionHeading = new RegExp(
  `^## (?:\\[${escapedVersion}\\]|${escapedVersion})(?:\\s|$|\\])`,
  "m",
);
if (!versionHeading.test(changelog)) {
  throw new Error(`CHANGELOG.md missing release heading for ${version}`);
}

console.log(JSON.stringify({ ok: true, version, refName: refName ?? null }));
