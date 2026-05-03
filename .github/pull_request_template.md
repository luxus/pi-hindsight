## Summary

-

## Change type

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] test
- [ ] refactor
- [ ] chore

## Memory invariants

- [ ] Retain still stores raw rich content, not summaries.
- [ ] Recall Blocks remain ephemeral and are not retained back into Hindsight.
- [ ] Project Bank and Global Bank isolation is preserved.
- [ ] Retain Queue behavior remains queue-first and retry-safe.
- [ ] Debug output and sidecars remain opt-in and redacted.
- [ ] Import behavior remains deterministic and idempotent when touched.

## Verification

- [ ] `npm run check`
- [ ] `npm run check:coverage`
- [ ] `npm run typecheck:tsc`
- [ ] `npm run pack:verify` (release/package changes)
- [ ] `npm run smoke:hindsight` (live Hindsight behavior changes, if credentials are available)

## Guidance sync

- [ ] If this changes source-of-truth order, contributor workflow, verification expectations, memory policy, or definition of done, `AGENTS.md` and `CONTRIBUTING.md` were updated together.

## Notes

Mention any ADR conflicts, skipped checks, live-smoke limitations, or follow-up issues.
