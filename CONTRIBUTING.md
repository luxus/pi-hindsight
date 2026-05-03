# Contributing to pi-hindsight

Thank you for helping improve `pi-hindsight`. This repository is a Pi extension that integrates with Hindsight, so changes must protect durable memory, project/global isolation, queue durability, and secret safety.

## Start here

Before making a change, read:

1. `CONTEXT.md` for the project vocabulary and invariants.
2. `AGENTS.md` for source-of-truth order, memory rules, and definition of done.
3. Any relevant ADR under `docs/adr/`.
4. The official Hindsight and Pi documentation when changing API behavior, hook behavior, package shape, or extension lifecycle behavior.

Use the terms from `CONTEXT.md` in issue titles, test names, PR descriptions, and docs. Prefer **Project Bank**, **Global Bank**, **Retain**, **Recall**, **Reflect**, **Retain Queue**, **Retain Job**, **Recall Block**, **Last-Recall Snapshot**, **Import Manifest**, **Import Checkpoint**, **Memory Operation Service**, and **Operation Catalog** over local synonyms.

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

Run the relevant targeted tests while developing, then run the full checks before considering the work done:

```bash
npm run check
npm run check:coverage
npm run typecheck:tsc
```

For release-path or packaging changes, also run:

```bash
npm run pack:verify
```

For live Hindsight integration changes, run a configured smoke test when credentials are available:

```bash
npm run smoke:hindsight
```

The GitHub `Hindsight Integration` workflow skips cleanly unless `HINDSIGHT_INTEGRATION_ENABLED=true` is configured.

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

## PR checklist

Before opening or marking a PR ready:

- [ ] I used project terms from `CONTEXT.md`.
- [ ] I kept the diff focused.
- [ ] I preserved Retain, Recall, Reflect, bank isolation, queue-first, and redaction invariants.
- [ ] I added or updated tests for meaningful behavior.
- [ ] I updated README/docs when user-visible behavior changed.
- [ ] I ran `npm run check`.
- [ ] I ran `npm run check:coverage` when touching critical paths.
- [ ] I ran `npm run typecheck:tsc`.
- [ ] I ran `npm run smoke:hindsight` when live Hindsight behavior changed and credentials were available.

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
