#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const sections = [
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["build", "Build System"],
  ["ci", "CI"],
  ["style", "Style"],
  ["chore", "Chores"],
  ["revert", "Reverts"],
];

const sectionByType = new Map(sections);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const repoUrl = String(packageJson.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");
const { stdout: latestCommitDate } = await execFileAsync("git", ["log", "-1", "--format=%cs"]);
const releaseDate = latestCommitDate.trim();
const { stdout } = await execFileAsync("git", ["log", "--no-merges", "--format=%H%x00%s"]);
const groups = new Map(sections.map(([, section]) => [section, []]));
groups.set("Other Changes", []);

function parseSubject(subject) {
  const match = /^(\w+)(?:\([^)]*\))?!?:\s+(.+)$/.exec(subject);
  if (!match) return { section: "Other Changes", title: subject };
  const [, type, title] = match;
  return { section: sectionByType.get(type) ?? "Other Changes", title };
}

for (const line of stdout.split("\n").filter(Boolean)) {
  const [hash, subject] = line.split("\0");
  if (!hash || !subject) continue;
  const { section, title } = parseSubject(subject);
  const short = hash.slice(0, 7);
  const link = repoUrl ? `([${short}](${repoUrl}/commit/${hash}))` : `(${short})`;
  groups.get(section)?.push(`- ${title} ${link}`);
}

const lines = ["# Changelog", "", `## ${packageJson.version} (${releaseDate})`, ""];
for (const [, section] of [...sections, ["other", "Other Changes"]]) {
  const entries = groups.get(section) ?? [];
  if (!entries.length) continue;
  lines.push(`### ${section}`, "", ...entries, "");
}

await writeFile("CHANGELOG.md", `${lines.join("\n").trim()}\n`, "utf8");
