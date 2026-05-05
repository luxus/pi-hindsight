## Summary

-

## Linked issue

- Closes/updates #

## Scope

-

## Verification

- [ ] `npm run check`
- [ ] `npm run check:coverage` (source, tests, critical paths, or `ci:coverage`)
- [ ] `npm run typecheck:tsc` (source/critical paths or full CI)
- [ ] full matrix requested/passed (runtime, queue/import, package/release, workflow changes, or `ci:full`)
- [ ] package verification requested/passed (release/package changes or `ci:package`)
- [ ] `npm run pack:verify` (release/package changes)
- [ ] `npm run smoke:hindsight` or configured `Hindsight Integration` pass (memory-path behavior changes or `ci:live-smoke`; document unavailable live proof)

## Release impact

Check exactly one:

- [ ] No release impact
- [ ] User-visible change
- [ ] Package/release path change

Explain changelog/release notes impact, or say none.

## Risk and rollback

- Risk:
- Rollback/revert path:

## Follow-ups

- None, or link issue(s): #

## Memory invariants

- [ ] Retain still stores raw rich content, not summaries.
- [ ] Recall Blocks remain ephemeral and are not retained back into Hindsight.
- [ ] Project Bank and Global Bank isolation is preserved.
- [ ] Retain Queue behavior remains queue-first and retry-safe.
- [ ] Debug output and sidecars remain opt-in and redacted.
- [ ] Import behavior remains deterministic and idempotent when touched.

## Guidance sync

- [ ] If this changes source-of-truth order, contributor workflow, verification expectations, memory policy, or definition of done, `AGENTS.md` and `CONTRIBUTING.md` were updated together.

## Agent checklist

- [ ] I read and followed `AGENTS.md` and `CONTRIBUTING.md`.
- [ ] I linked the issue before implementation.
- [ ] I kept the diff focused on one vertical slice.
- [ ] Final branch contains only focused, reviewable commits.
- [ ] I did not bypass hooks or checks.
- [ ] I documented skipped checks with reasons.

## Notes

Mention any ADR conflicts, skipped checks, live-smoke limitations, or follow-up issues. Track follow-ups in GitHub Issues, not hidden local TODOs.
