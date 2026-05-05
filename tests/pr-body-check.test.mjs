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
- [x] I linked the issue before implementation.
- [x] Final branch contains only focused, reviewable commits.
- [x] I did not bypass hooks or checks.
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

  it("rejects placeholder summary and scope sections", () => {
    const body = validBody
      .replace("- Add release guardrails.", "- TODO")
      .replace("- Docs and workflow only.", "- TBD");

    expect(validatePrBody(body)).toEqual([
      "Summary section must describe the change.",
      "Scope section must describe the focused vertical slice.",
    ]);
  });

  it("requires exactly one release impact choice", () => {
    const body = validBody.replace(
      "- [x] No release impact\n- [ ] User-visible change\n- [ ] Package/release path change",
      "- [x] No release impact\n- [x] User-visible change\n- [ ] Package/release path change",
    );

    expect(validatePrBody(body)).toContain(
      "Release impact section must check exactly one impact option.",
    );
  });

  it("requires risk plus rollback or revert guidance", () => {
    const body = validBody.replace("Low. Revert docs/workflow changes.", "Low.");

    expect(validatePrBody(body)).toContain(
      "Risk and rollback section must describe risk and rollback/revert path.",
    );
  });

  it("requires issue linkage and no-bypass confirmations in the agent checklist", () => {
    const body = validBody
      .replace(
        "- [x] I linked the issue before implementation.",
        "- [ ] I linked the issue before implementation.",
      )
      .replace(
        "- [x] I did not bypass hooks or checks.",
        "- [ ] I did not bypass hooks or checks.",
      );

    expect(validatePrBody(body)).toEqual([
      "Agent checklist must confirm issue linkage before implementation.",
      "Agent checklist must confirm hooks/checks were not bypassed.",
    ]);
  });
});
