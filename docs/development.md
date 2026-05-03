# Development

## Install dependencies

```bash
npm install
```

`npm install` installs the repo hook path. `.githooks/pre-commit` runs `npm run precommit`, and `.githooks/commit-msg` enforces Conventional Commits 1.0.0.

Do not use `git commit --no-verify` or any equivalent bypass.

## Run checks

Full precommit suite:

```bash
npm run check
```

This runs:

- formatting with `oxfmt`
- type-aware linting with `oxlint`
- `tsgo` typecheck
- Vitest suite

Critical-path coverage gate:

```bash
npm run check:coverage
```

Secondary TypeScript compiler check:

```bash
npm run typecheck:tsc
```

Useful targeted checks:

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm test -- tests/queue.test.ts
```

## Run Pi locally

```bash
pi -e ./extensions/index.ts
```

Or install the checkout path:

```bash
pi install /path/to/pi-hindsight
```

## Work tracking

Use GitHub Issues as the project task ledger. Backlog items, current work, blockers, decisions, and follow-ups should be visible in issues or issue comments. Do not rely on local scratch files, chat-only plans, or private harness TODOs as the source of truth for project work.

When a report or review creates actionable work, turn accepted items into issues and remove or archive the scratch file after the issues carry the work.

## Coverage gates

Critical-path coverage thresholds are configured in `vitest.config.ts` for:

- queue
- queue lock
- JSONL queue store
- import Modules
- config Modules
- lifecycle Modules
- transport Modules

## Live smoke

For memory-path behavior changes, prove the live path with a configured Hindsight server:

```bash
export HINDSIGHT_BASE_URL=http://localhost:8888
# export HINDSIGHT_API_KEY=... # if needed
npm run smoke:hindsight
```

The GitHub `Hindsight Integration` workflow also runs live smoke when configured. An unconfigured workflow skip is not proof for memory-path changes.

## Source-of-truth order

1. Official Hindsight docs and API behavior
2. Official Pi extension/session/package docs
3. This repository's PRD, plans, ADRs, `CONTEXT.md`, `AGENTS.md`, and `CONTRIBUTING.md`
4. Public reference repos as implementation inspiration only
5. User notes and gists as hypotheses only

## Definition of done

A change is done only when:

1. it follows official Hindsight memory rules;
2. it uses documented Pi extension hooks;
3. tests cover changed logic;
4. user-visible behavior is documented if changed;
5. the diff is minimal and focused; and
6. no new memory anti-pattern is introduced.

## Changelog

`CHANGELOG.md` is generated from Conventional Commits:

```bash
npm run changelog
```

The `version` script also regenerates and stages `CHANGELOG.md` during `npm version`. Do not hand-edit generated release entries as the source of truth.
