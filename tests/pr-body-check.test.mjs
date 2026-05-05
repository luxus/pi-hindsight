import { describe, expect, it } from "vitest";
// @ts-expect-error check-pr-body is a small Node script without declarations.
import { validatePrBody } from "../scripts/check-pr-body.mjs";

const validBody = `## Summary

- Add release guardrails.

## Linked issue

- Closes #202

## Scope

- Docs and workflow only.

## Verification

- [x] \`npm run check\`
- [ ] \`npm run check:coverage\` — not needed because docs-only.

## Release impact

- [x] No release impact
- [ ] User-visible change
- [ ] Package/release path change

## Risk and rollback

Low. Revert docs/workflow changes.

## Follow-ups

None.

## Agent checklist

- [x] I read and followed \`AGENTS.md\` and \`CONTRIBUTING.md\`.
- [x] Final branch contains only focused, reviewable commits.
`;

describe("check-pr-body", () => {
  it("accepts a PR body with required agent checklist artifacts", () => {
    expect(validatePrBody(validBody)).toEqual([]);
  });

  it("rejects missing issue linkage and unchecked agent checklist proof", () => {
    const body = validBody
      .replace("- Closes #202", "- TODO")
      .replace("- [x] I read", "- [ ] I read");

    expect(validatePrBody(body)).toEqual([
      "Linked issue section must include Closes/Fixes/Resolves/Refs/Updates #<number>.",
      "Agent checklist must confirm AGENTS.md and CONTRIBUTING.md were read and followed.",
    ]);
  });

  it("does not accept check:coverage as proof that check ran", () => {
    const body = validBody.replace(
      "- [x] `npm run check`\n- [ ] `npm run check:coverage` — not needed because docs-only.",
      "- [ ] `npm run check` — not run because example.\n- [x] `npm run check:coverage`",
    );

    expect(validatePrBody(body)).toContain("Verification section must check `npm run check`.");
  });
});
