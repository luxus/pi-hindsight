#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";

export const requiredHeadings = [
  "Summary",
  "Linked issue",
  "Scope",
  "Verification",
  "Release impact",
  "Risk and rollback",
  "Follow-ups",
  "Agent checklist",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function section(body, heading) {
  const pattern = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
    "im",
  );
  return pattern.exec(body)?.[1]?.trim() ?? "";
}

function hasSubstantiveContent(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line && !/^[-*]?\s*(todo|tbd|n\/a|none|#?)$/i.test(line));
}

function checkedLines(value, labelPattern) {
  return value.split("\n").filter((line) => /^- \[[xX]\]/.test(line) && labelPattern.test(line));
}

export function validatePrBody(body) {
  const errors = [];
  const text = body.trim();

  if (!text) {
    return ["PR body is empty. Use .github/pull_request_template.md."];
  }

  for (const heading of requiredHeadings) {
    if (!new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im").test(text)) {
      errors.push(`Missing required heading: ## ${heading}`);
    }
  }

  const summary = section(text, "Summary");
  if (!hasSubstantiveContent(summary)) {
    errors.push("Summary section must describe the change.");
  }

  const linkedIssue = section(text, "Linked issue");
  if (!/(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|updates?)\s+#\d+/i.test(linkedIssue)) {
    errors.push("Linked issue section must include Closes/Fixes/Resolves/Refs/Updates #<number>.");
  }

  const scope = section(text, "Scope");
  if (!hasSubstantiveContent(scope)) {
    errors.push("Scope section must describe the focused vertical slice.");
  }

  const verification = section(text, "Verification");
  if (!/^- \[[xX]\] (?:`npm run check`|npm run check)(?:\s|$)/m.test(verification)) {
    errors.push("Verification section must check `npm run check`.");
  }
  if (
    /not run|skipped/i.test(verification) &&
    !/because|reason|unavailable|blocked/i.test(verification)
  ) {
    errors.push("Skipped verification must include a reason.");
  }

  const releaseImpact = section(text, "Release impact");
  const releaseImpactChoices = checkedLines(
    releaseImpact,
    /(No release impact|User-visible change|Package\/release path change)/,
  );
  if (releaseImpactChoices.length !== 1) {
    errors.push("Release impact section must check exactly one impact option.");
  }

  const risk = section(text, "Risk and rollback");
  if (!hasSubstantiveContent(risk) || !/rollback|revert|back out|disable/i.test(risk)) {
    errors.push("Risk and rollback section must describe risk and rollback/revert path.");
  }

  const followUps = section(text, "Follow-ups");
  if (!/(none|n\/a|#\d+)/i.test(followUps)) {
    errors.push("Follow-ups section must say None/N/A or link follow-up issue(s).");
  }

  const agentChecklist = section(text, "Agent checklist");
  if (!/- \[[xX]\] I read and followed `AGENTS\.md` and `CONTRIBUTING\.md`/.test(agentChecklist)) {
    errors.push(
      "Agent checklist must confirm AGENTS.md and CONTRIBUTING.md were read and followed.",
    );
  }
  if (!/- \[[xX]\] I linked the issue before implementation/.test(agentChecklist)) {
    errors.push("Agent checklist must confirm issue linkage before implementation.");
  }
  if (!/- \[[xX]\] Final branch contains only focused, reviewable commits/.test(agentChecklist)) {
    errors.push("Agent checklist must confirm focused, reviewable commits.");
  }
  if (!/- \[[xX]\] I did not bypass hooks or checks/.test(agentChecklist)) {
    errors.push("Agent checklist must confirm hooks/checks were not bypassed.");
  }

  return errors;
}

async function readBodyFromInputs() {
  const explicitPath = process.argv[2];
  if (explicitPath) return readFile(explicitPath, "utf8");

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const event = JSON.parse(await readFile(eventPath, "utf8"));
    return String(event.pull_request?.body ?? "");
  }

  stdin.setEncoding("utf8");
  let body = "";
  for await (const chunk of stdin) body += chunk;
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = await readBodyFromInputs();
  const errors = validatePrBody(body);
  if (errors.length) {
    console.error("PR body checklist failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("PR body checklist passed.");
}
