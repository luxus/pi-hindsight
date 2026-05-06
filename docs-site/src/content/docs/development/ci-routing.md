---
title: "CI routing"
---

GitHub PR CI is tiered by change impact.

## Fast checks

Low-impact docs/TUI changes run fast Ubuntu checks by default.

## Coverage and compiler fallback

Source, tests, critical paths, or explicit `ci:coverage` work runs coverage and TypeScript compiler fallback.

## Full matrix

Normal pull requests do not run macOS/Windows matrix lanes by default. Runtime-sensitive paths, queue/import/memory-path changes, and source/test changes use Ubuntu fast checks plus coverage/compiler fallback and live smoke when applicable.

Run the full Ubuntu/macOS/Windows matrix for release PRs/release verification, manual `workflow_dispatch`, non-PR events, or PRs explicitly labeled `ci:full`.

## Package verification

Package/release changes and `ci:package` run package verification.

## Live smoke

The Hindsight Integration workflow runs for memory-path changes, the `memory-path`/`ci:live-smoke` labels, nightly schedule, and manual dispatch. It only performs live smoke when configured with Hindsight credentials. An unconfigured skip is not proof for memory-path changes.

## PR checklist gate

Pull requests must complete the repository PR template. The checklist gate verifies required sections and checklist artifacts so verification, risk, release impact, and follow-ups are explicit.
