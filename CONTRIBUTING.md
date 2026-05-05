# Contributing to pi-hindsight

Thank you for helping improve `pi-hindsight`. This repository is a Pi extension that integrates with Hindsight, so changes must protect durable memory, project/global isolation, queue durability, and secret safety.

## Start here

Before making a change, read:

1. `CONTEXT.md` for the project vocabulary and invariants.
2. `AGENTS.md` for source-of-truth order, memory rules, and definition of done.
3. Any relevant ADR under `docs/adr/`.
4. The official Hindsight and Pi documentation when changing API behavior, hook behavior, package shape, or extension lifecycle behavior.

Use the terms from `CONTEXT.md` in issue titles, test names, PR descriptions, and docs. Prefer **Project Bank**, **Global Bank**, **Retain**, **Recall**, **Reflect**, **Retain Queue**, **Retain Job**, **Recall Block**, **Last-Recall Snapshot**, **Import Manifest**, **Import Checkpoint**, **Memory Operation Service**, and **Operation Catalog** over local synonyms.

Human and agent guidance must stay aligned. If you change source-of-truth order, contributor workflow, verification expectations, memory policy, or definition-of-done criteria, update both this file and `AGENTS.md` in the same PR.

## Source-of-truth order

Use this order when implementation choices conflict:

1. Official Hindsight docs and API behavior.
2. Official Pi extension, session, and package docs.
3. This repository's PRDs, ADRs, and coding plans.
4. Public reference repos as implementation inspiration only.
5. User notes and gists as hypotheses only.

Do not invent undocumented Pi internals or undocumented Hindsight request shapes. Prefer the official Hindsight TypeScript client and the documented Pi extension lifecycle.

## Development setup

This package targets the runtime declared in `package.json`.

```bash
npm install
npm run check
```

`npm install` installs the repository Git hooks. Do not bypass them. The pre-commit hook runs `npm run precommit`, and the commit message hook enforces Conventional Commits.

## Change discipline

Keep each PR focused on one vertical slice. A good PR has:

- a clear user or maintainer outcome
- a small diff
- tests for changed behavior
- docs updates when behavior or workflow changes
- no new memory anti-patterns

Avoid combining architecture changes, product behavior, and release automation in the same PR unless they are inseparable.

## Work tracking

GitHub Issues are the project task ledger for backlog items, current work, blockers, decisions, and follow-ups. Use the `gh` CLI from this repository to create, read, comment on, label, assign, and close issues.

Do not rely on local scratch files, private harness TODOs, chat-only plans, or hidden task lists as the source of truth for project work. If a change needs tracking, create or update a GitHub issue before continuing. If a report or review produces useful work, move the accepted items into GitHub issues and remove or archive the scratch report once the issues carry the actionable content.

Every PR should reference the issue it advances. If a follow-up remains, add it as an issue or as a comment on the existing issue rather than leaving it only in a local note.

## Continuous issue iteration

When a maintainer asks an agent to continue through the backlog, the expected loop is continuous but bounded. Continue issue-by-issue until there are no appropriate open issues left, the maintainer stops the loop, or a blocker requires human judgment. Respect explicit deferrals, roadmap ordering, and source-of-truth priorities.

For each slice:

1. Select or create a GitHub issue before implementation starts.
2. Create a focused branch from up-to-date `main`.
3. Implement the smallest vertical slice that satisfies the issue.
4. Run targeted tests during development, then the repository checks required by the change impact.
5. Commit with a Conventional Commit subject and do not bypass hooks.
6. Run a review pass before opening a PR. A subagent reviewer is acceptable and encouraged for non-trivial changes.
7. Fix review findings before PR creation unless the PR explicitly documents why a recommendation was rejected.
8. Push the branch and open a PR with the required template completed.
9. Watch CI without blocking foreground planning. Use a managed process, scheduled reminder, or subagent/checker. If checks are still pending, set a short reminder instead of repeatedly polling. If checks fail, inspect and fix before merge.
10. Merge only after required checks pass and review blockers are resolved.
11. Comment on and close the issue with delivered behavior, verification, and follow-up issue links.
12. Return to `main`, sync with `origin/main`, and continue with the next slice.

Keep one implementation slice active at a time unless a maintainer explicitly asks for parallel work. Do not mix unrelated cleanup, formatting sweeps, or drive-by refactors into the current branch. If review uncovers work outside the slice, create a follow-up issue and continue after the current PR is complete.

## Commit and PR discipline for agents

Agents must not push directly to `main`, tag releases, publish packages, or merge PRs unless a maintainer explicitly asks for that action. A maintainer instruction to run the continuous issue loop counts as merge authorization for PRs that satisfy the documented loop. Work should happen on a branch and flow through a PR.

Before implementation starts, link the change to a GitHub issue. Keep each branch and PR to one focused vertical slice. Do not bundle drive-by refactors, formatting sweeps, or unrelated cleanup unless the issue explicitly asks for them.

Use Conventional Commits for final commit subjects because release automation, changelog generation, and release notes consume them as source of truth. Keep commits small and logical. Clean up noisy WIP commits before review when the workflow allows it. Never bypass Git hooks or checks with `--no-verify` or equivalent flags.

Every PR must complete the repository PR template. The template is intentionally machine-checkable: linked issue, scope, verification, release impact, risk and rollback, follow-ups, and agent checklist. If a check was skipped, the PR must say why. If follow-up work remains, link a GitHub issue.

## Memory invariants

Every code change must preserve these rules:

- **Retain** stores raw rich content, not summaries.
- Automatic retain uses stable live session document IDs and `append` mode.
- Historical imports use deterministic document IDs and preserve reimport idempotency.
- **Recall** happens before answer generation and remains ephemeral.
- **Recall Blocks** must not be persisted into transcript history or retained back into Hindsight.
- **Global Bank** writes are explicit by default; automatic global retain requires explicit Router Mode.
- Tags define scope and visibility; metadata records provenance.
- Retain paths are queue-first.
- Debug visibility is opt-in and must redact secrets before persistence.

If a change intentionally reopens one of these invariants, document the contradiction in the PR and add or update an ADR.

## Tests and verification

Run the relevant targeted tests while developing, then run the checks required by the change impact before considering the work done:

```bash
npm run check
```

`npm run check` includes `npm run docs:check`, so the normal fast path builds the documentation site, validates internal documentation routes/sidebar entries, and checks generated surface-reference docs. When iterating only on documentation-site content, run the narrower docs path first:

```bash
npm run docs:check
```

Run these for source, tests, critical paths, or full-CI work:

```bash
npm run check:coverage
npm run typecheck:tsc
```

GitHub PR CI is tiered. Low-impact docs/TUI changes run the fast Ubuntu check by default. Source, tests, critical paths, and `ci:coverage` run coverage and the TypeScript compiler fallback. Runtime-sensitive paths, queue/import/memory-path changes, package/release changes, workflow changes, and `ci:full` run the full Ubuntu/macOS/Windows matrix. Package/release changes and `ci:package` also run package verification. Manual `workflow_dispatch` can run the full matrix for any PR.

For release-path or packaging changes, also run:

```bash
npm run pack:verify
```

For memory-path behavior changes, prove the live Hindsight path before merging. Memory-path behavior includes retain payloads, recall queries/formatting, reflect calls, bank selection or creation, queue delivery, import delivery, Adapter transport, smoke helpers, and release packaging that can affect installed runtime behavior.

Preferred proof is a configured smoke test:

```bash
npm run smoke:hindsight
```

The GitHub `Hindsight Integration` workflow runs automatically for memory-path changes, `memory-path`/`ci:live-smoke` labels, nightly schedule, and manual dispatch. It still skips cleanly unless `HINDSIGHT_INTEGRATION_ENABLED=true` is configured. For memory-path PRs, do not treat an unconfigured skip as proof; either run the smoke test locally with credentials, confirm a configured workflow pass, or document why live proof is unavailable and what lower-level checks cover the risk.

## Commit messages

Use Conventional Commits 1.0.0:

```text
<type>[optional scope]: <description>
```

Common types include `feat`, `fix`, `docs`, `test`, `refactor`, and `chore`.

Examples:

```text
feat(recall): debug failed last recall
fix(queue): quarantine malformed retain jobs
docs: add project domain context
```

Do not use `git commit --no-verify` or any equivalent bypass.

## Definition of done

A change is done only when:

1. it follows the official Hindsight memory rules;
2. it uses documented Pi extension hooks;
3. tests cover the changed logic;
4. user-visible behavior is documented if changed;
5. the diff is minimal and focused; and
6. no new memory anti-pattern was introduced.

## PR checklist

Before opening or marking a PR ready:

- [ ] I used project terms from `CONTEXT.md`.
- [ ] I linked or updated the relevant GitHub issue, including follow-ups or blockers.
- [ ] I kept the diff focused.
- [ ] I preserved Retain, Recall, Reflect, bank isolation, queue-first, and redaction invariants.
- [ ] I added or updated tests for meaningful behavior.
- [ ] I updated README/docs when user-visible behavior changed.
- [ ] I updated `AGENTS.md` and `CONTRIBUTING.md` together when source-of-truth order, workflow, verification, or definition-of-done guidance changed.
- [ ] I ran `npm run check`.
- [ ] I ran `npm run check:coverage` when touching source, tests, or critical paths.
- [ ] I ran `npm run typecheck:tsc` when touching source or critical paths.
- [ ] I requested or confirmed full matrix when touching runtime-sensitive paths, queue/import/memory paths, package/release code, workflows, or platform-sensitive behavior.
- [ ] I ran `npm run audit:signatures` when touching release/package dependencies.
- [ ] I ran `npm run smoke:hindsight` or confirmed a configured `Hindsight Integration` pass when memory-path behavior changed; if unavailable, I documented the limitation.

## Architecture guidance

Prefer deep modules with narrow interfaces. Keep these boundaries intact:

- `extensions/index.ts` wires Pi hooks, commands, and tools.
- lifecycle modules own turn-level automatic memory policy.
- Memory Operation Service modules own explicit user intents.
- the Hindsight Adapter seam owns Hindsight request behavior.
- queue modules own queue files, locks, retries, and dead letters.
- import modules own historical session parsing, planning, checkpointing, and delivery.
- config modules keep parsing, normalization, writing, and TUI metadata deterministic and narrow.

When adding a new config setting, update the defaults, normalization, types, writer, TUI/config editing registry if appropriate, tests, diagnostics, and docs as a single focused slice.
