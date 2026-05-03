# Release

Release automation publishes `@luxusai/pi-hindsight` through npm trusted publishing with GitHub OIDC. The workflow does not use `NPM_TOKEN`.

## Release checks

Before publishing or tagging a release:

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

## Versioning flow

1. Ensure `main` is synced.
2. Run release checks.
3. Run `npm run changelog` after final Conventional Commits.
4. Use `npm version <patch|minor|major>` so the version script stages the regenerated changelog.
5. Push a `v*.*.*` tag to run the release workflow.

Manual workflow dispatch can verify only or publish when `publish=true`.
