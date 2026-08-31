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

- docs checks with `docs:check`: generated surface-reference freshness, generated code-map freshness, internal docs links/sidebar routes, packaged Markdown links, GitHub Pages base-prefixed docs links, and docs-site build
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

## Documentation architecture

Use `docs/documentation-architecture.md` as the migration map for documentation-site work, navigation changes, generated reference placement, and archive decisions.

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
# export HINDSIGHT_API_TOKEN=... # if needed (or HINDSIGHT_API_KEY)
npm run smoke:hindsight
```

The GitHub `Hindsight Integration` workflow also runs live smoke when configured. An unconfigured workflow skip is not proof for memory-path changes.

## Memory benchmark

`npm run bench:memory` replays scripted multi-session scenarios (a lifeOS personal-facts scenario and a coding-decisions scenario, each spanning several sessions) through the real recall/retain lifecycle against a live Hindsight, then scores memory quality:

```bash
export HINDSIGHT_INTEGRATION_ENABLED=true
export HINDSIGHT_BASE_URL=http://localhost:8888
# export HINDSIGHT_API_TOKEN=... # if needed (or HINDSIGHT_API_KEY)
npm run bench:memory
```

The run prints and saves a JSON report (path is logged; override with `PI_HINDSIGHT_BENCH_REPORT`). Metrics, all in `[0,1]`:

- `recallHitRate` — fraction of later-session questions whose planted fact surfaced in the injected recall block (higher is better).
- `contaminationRate` — `1` if a recall block leaked into a retained payload, else `0` (must stay `0`).
- `duplicateRetainRate` — fraction of messages re-retained when replaying an already-retained session (must stay `0`).
- `tokenBudgetAdherence` — fraction of recalls whose injected block fit the configured `recall.maxTokens` budget (higher is better).

The benchmark is gated like live smoke: it skips unless `HINDSIGHT_INTEGRATION_ENABLED=true`, and runs in the label-gated `Hindsight Integration` lane (labels `ci:live-smoke` or `memory-path`). Compare reports across runs to catch regressions from refactors or Hindsight upgrades.

## Startup benchmark

Measure Pi readiness with and without this extension using fresh temporary config directories and offline RPC mode:

```bash
npm run bench:startup
```

Set `PI_STARTUP_BENCH_RUNS` or `PI_STARTUP_BENCH_WARMUPS` to change the sample counts. Pass an extension entrypoint after `--` to compare another build:

```bash
npm run bench:startup -- ./extensions/index.ts
```

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

## Changelog and releases

`CHANGELOG.md` is generated from Conventional Commits. The normal release path is release-please: it opens a release PR that updates version metadata and the changelog, then creates the tag and GitHub release after merge.

Local fallback:

```bash
npm run changelog
```

The `version` script also regenerates and stages `CHANGELOG.md` during `npm version`. Use these scripts for inspection or emergency manual releases, not as the normal source of truth. Do not hand-edit generated release entries as the source of truth.
