# Release

Release automation uses [`release-please`](https://github.com/googleapis/release-please) to turn Conventional Commits on `main` into a release PR. The release PR updates `package.json`, `package-lock.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.

After the release PR merges, release-please creates the tag and GitHub release. The release-please config intentionally disables component tag prefixes so generated tags stay in the `vX.Y.Z` namespace used by the release workflow, rather than `pi-hindsight-vX.Y.Z`. The existing `Release` workflow then verifies and publishes `@luxusai/pi-hindsight` through npm trusted publishing with GitHub OIDC. The workflow does not use `NPM_TOKEN`.

## Release checks

Before merging a release PR or manually publishing a release, run or confirm:

```bash
npm run check
npm run check:coverage
npm run typecheck:tsc
npm run audit:signatures
npm run pack:verify
```

For memory-path changes, also prove the live Hindsight path:

```bash
export HINDSIGHT_BASE_URL=http://localhost:8888
# export HINDSIGHT_API_KEY=... # if needed
npm run smoke:hindsight
```

`check:release` combines the normal check suite, coverage, secondary `tsc` typecheck, audit signatures, pack verification, and live smoke:

```bash
npm run check:release
```

## Release PR flow

1. Merge feature and fix PRs into `main` with Conventional Commit subjects.
2. The `Release Please` workflow opens or updates a release PR.
3. Review the release PR changelog, version bump, and manifest update.
4. Confirm release/package verification passes. Use the `ci:package` or `ci:full` labels if additional gates are needed.
5. Merge the release PR.
6. Release-please creates the `v*.*.*` tag and GitHub release.
7. The `Release` workflow verifies the tag and publishes to npm through trusted publishing.

Manual `Release Please` workflow dispatch can refresh the release PR if needed.

## Local changelog fallback

`npm run changelog` and the `version` script remain available for local inspection or emergency manual releases. They are not the normal source of truth once release-please is active. Do not hand-edit generated release entries as the source of truth.

## Live smoke

The smoke test creates a temporary bank, retains a unique marker with `updateMode: "append"`, recalls it, and runs `reflect`.

It also exercises:

- official Hindsight client path
- extension Adapter path (`createHindsightClient`)
- memory operations service
- explicit retain/flush/recall/reflect/receipts
- tiny Pi JSONL import dry-run/write/recall flow
- GitHub Actions Markdown summary output
- temporary-bank cleanup on success

Step markers include:

```text
bank_ok
retain_ok
recall_ok
reflect_ok
adapter_retain_ok
adapter_recall_ok
adapter_reflect_ok
operations_retain_ok
operations_flush_ok
operations_recall_ok
operations_reflect_ok
operations_receipts_ok
import_dry_run_ok
import_ok
import_recall_ok
cleanup_ok
```

Successful temp banks are cleaned up. Failure artifacts are kept for debugging. If `PI_HINDSIGHT_SMOKE_BANK_ID` points at a configured bank, cleanup is skipped.

## GitHub live integration

The `Hindsight Integration` workflow runs on PRs, nightly schedule, and manual dispatch. It runs live smoke only when enabled.

Required repository variable:

- `HINDSIGHT_INTEGRATION_ENABLED=true`

Required secret when enabled:

- `HINDSIGHT_BASE_URL`

Optional secret and variables:

- `HINDSIGHT_API_KEY`
- `HINDSIGHT_SMOKE_ATTEMPTS`, default `20`
- `HINDSIGHT_SMOKE_CLEANUP_TIMEOUT_MS`, default `5000`
- `PI_HINDSIGHT_SMOKE_BANK_ID`

An unconfigured workflow skip is not release proof for memory-path changes.

## Manual publish fallback

Manual workflow dispatch of the `Release` workflow can verify only, or publish when `publish=true`. Use this fallback only when the normal release-please tag flow is blocked and a maintainer explicitly approves the manual release.
