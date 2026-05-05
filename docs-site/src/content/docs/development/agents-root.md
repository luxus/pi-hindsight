---
title: "AGENTS.md"
---

# AGENTS.md

## Project mission

Build a Pi extension that gives Pi durable long-term memory through Hindsight.

The extension must be:

- technically aligned with official Hindsight best practices
- idiomatic to Pi’s extension/package model
- reliable under outages
- easy to inspect, debug, and extend
- safe to use as the base for future Pi extensions

## Source of truth

### Technical source order

1. Official Hindsight docs and API behavior
2. Official Pi `pi-mono` extension/session/package docs
3. This repository’s PRD and coding plan
4. Public reference repos only as implementation inspiration
5. User notes/gists only as hypotheses, never as authority

### Use these constraints

- Use the official Hindsight TypeScript client
- Treat Hindsight docs and OpenAPI behavior as source of truth
- Treat Pi’s documented extension lifecycle as source of truth
- Do not invent undocumented Pi internals or undocumented Hindsight request shapes

### Shared contributor guidance

Human and agent guidance must stay aligned. When changing source-of-truth order, contributor workflow, verification expectations, memory policy, or definition-of-done criteria, update `CONTRIBUTING.md` and this file together. `CONTEXT.md` is the shared vocabulary for both human-facing and agent-facing docs.

### Work tracking

GitHub Issues are the project task ledger. Use `gh` for backlog items, roadmap slices, current multi-step work, blockers, follow-ups, and done/close updates. Do not use harness-private or local hidden TODO systems as the source of truth for project work. If work needs tracking, create or update a GitHub issue before continuing.

When starting from a report, review, plan, or research note, convert accepted work into GitHub issues and delete or archive the scratch note after the issues carry the actionable content. When finishing work, update or close the relevant issue with the verification performed and any follow-up issue numbers.

### Continuous issue iteration

When explicitly asked to continue through the backlog, keep working issue-by-issue until there are no appropriate open issues left, the user stops the loop, or a blocker requires human judgment. Prefer the next unblocked, highest-value issue. Respect explicit deferrals such as delayed issues, roadmap ordering, and source-of-truth priorities.

Use this loop for each slice:

1. Select or create a GitHub issue before implementation starts.
2. Create a focused branch from up-to-date `main`.
3. Implement the smallest vertical slice that satisfies the issue.
4. Run targeted tests while developing, then the required repository checks.
5. Commit with a Conventional Commit subject and without bypassing hooks.
6. Run a review pass before opening a PR. A subagent reviewer is acceptable and encouraged for non-trivial changes.
7. Fix review findings before PR creation unless explicitly documenting a rejected recommendation.
8. Push the branch and open a PR with the required template completed.
9. Watch CI without blocking foreground planning: use a managed process, scheduled reminder, or subagent/checker. If checks are still pending, set a short reminder instead of polling manually. If checks fail, inspect and fix before merge.
10. Merge only after required checks pass and review blockers are resolved.
11. Comment on and close the issue with delivered behavior, verification, and follow-up issues.
12. Return to `main`, sync with `origin/main`, and continue with the next slice.

Keep exactly one implementation slice active at a time unless the user explicitly asks for parallel work. Do not mix unrelated cleanup or drive-by refactors into the current branch. If a review uncovers new work outside the slice, create a follow-up issue and continue after the current PR is complete.

### Commit and PR discipline for agents

Agents must not push directly to `main`, tag releases, publish packages, or merge PRs unless a maintainer explicitly asks for that action. A maintainer instruction to run the continuous issue loop counts as merge authorization for PRs that satisfy the documented loop. Work should happen on a branch and flow through a PR.

Before implementation starts, link the change to a GitHub issue. Keep each branch and PR to one focused vertical slice. Do not bundle drive-by refactors, formatting sweeps, or unrelated cleanup unless the issue explicitly asks for them.

Use Conventional Commits for final commit subjects because release automation, changelog generation, and release notes consume them as source of truth. Keep commits small and logical. Clean up noisy WIP commits before review when the workflow allows it. Never bypass Git hooks or checks with `--no-verify` or equivalent flags.

Every PR must complete the repository PR template. The template is intentionally machine-checkable: linked issue, scope, verification, release impact, risk and rollback, follow-ups, and agent checklist. If a check was skipped, the PR must say why. If follow-up work remains, link a GitHub issue.

## Hard rules

### Retain rules

- Retain raw rich content, not summaries.
- For conversations, prefer structured JSON payloads.
- Always set `context`.
- Use a stable `document_id` per live Pi session.
- Use `update_mode: "append"` for ongoing live sessions.
- Use `replace` only for deterministic historical reimports or full rebuilds.
- Never use random `document_id`s for repeated writes to the same live session.
- Do not retain and then expect those memories to be available for recall in the same turn.

### Recall rules

- Recall should happen before answer generation.
- Recall injection must be ephemeral by default.
- Recalled memory blocks must not be persisted into Pi transcript history.
- Prefer Pi’s `context` hook for automatic injection.
- Use `before_provider_request` to inspect serialization and prompt-cache effects, not as the default logic path.
- Keep recall token budget conservative unless the task explicitly requires deep memory context.

### Reflect rules

- `reflect` is for synthesis and reasoning from memory.
- `recall` is for raw facts.
- Do not route all automatic memory behavior through `reflect`.
- Expose `reflect` as an explicit tool/command.

### Filtering rules

- Use `tags` for memory scope and visibility.
- Use `metadata` only for provenance and links back to source records.
- Do not rely on metadata for filtering behavior.
- Default strict tag matching whenever scope isolation matters.

### Bank rules

- Default to one project bank per repo.
- Optional second global bank is allowed only through explicit config.
- Do not default to one giant shared bank across unrelated repos.
- If bank creation/configuration is needed, do it intentionally during initialization or setup, not accidentally on first write.

### Safety rules

- Sanitize secrets before retain.
- Redact tokens, API keys, cookies, bearer headers, and private URLs where possible.
- Do not log raw retained payloads in normal mode.
- Keep any debug mode obviously opt-in.

## Current default design

### Package shape

Use:

- npm package
- `extensions/` directory
- one main entrypoint: `extensions/index.ts`
- `memory-lifecycle.ts` for one-turn hook policy
- `memory-operation-service.ts` for shared tool/command/setup intents
- `memory-identity.ts` and `memory-scope.ts` for repo/session/bank/document/tag policy
- `retain-cursor.ts` for persisted duplicate-retain prevention
- focused modules for config, config writing, client transport, bank operations, recall formatting, retain job building, queue durability, import parsing/branches/retain orchestration, tools, commands, diagnostics, status, and setup TUI

### Hook mapping

- `session_start` delegates to `memory-lifecycle.initialize`:
  - load config
  - initialize runtime
  - ensure bank settings if appropriate
  - update status
- `context` delegates to `memory-lifecycle.recall`:
  - select project/global memory scopes
  - compose fresh recall query
  - fetch memory
  - inject ephemeral memory block
- `agent_end` delegates to `memory-lifecycle.retain`:
  - gate retain by config
  - filter already retained messages using persisted cursor
  - build structured retain delta
  - sanitize
  - enqueue retain job before flush
- `session_shutdown` delegates to `memory-lifecycle.shutdown`:
  - flush queue best effort

### Explicit tools

Required:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_reflect`

Suggested commands:

- `/hindsight:status`
- `/hindsight:doctor`
- `/hindsight:config`
- `/hindsight:import`

## Implementation priorities

Implement in this order:

1. package scaffold and config resolution
2. Hindsight client adapter
3. bank derivation and identity mapping
4. automatic recall injection
5. automatic retain queue with append mode
6. explicit tools
7. diagnostics commands
8. historical session import
9. refinement of redaction/noise filtering

Do not jump ahead to advanced features before the default path is correct.

## Code guidelines

### Keep modules narrow

Examples:

- `config.ts` should not perform network I/O
- `client.ts` should not parse Pi session JSONL
- `import-sessions.ts` should not own queue replay logic
- `renderers.ts` should not contain Hindsight request composition
- tools and commands should call shared memory operation modules rather than duplicating intent behavior

### Prefer deterministic functions

Good candidates for pure tests:

- bank ID derivation
- tag generation
- document ID generation
- retain payload transformation
- recall block formatting
- secret redaction
- import message projection

### Avoid abstraction drift

Do not build:

- a generic “memory backends” layer
- a global plugin framework for all future extensions
- a “conversation model” wrapper if plain typed interfaces are enough

## Testing requirements

Every meaningful change should verify the relevant behavior.

Precommit is enforced through `.githooks/pre-commit` and must run `npm run precommit` before commits. Commit message validation is enforced through `.githooks/commit-msg` and must follow Conventional Commits 1.0.0 (`<type>[optional scope]: <description>`, with `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, etc.). Never use `git commit --no-verify` or any equivalent bypass. If any hook fails, fix the issue or ask the user how to proceed.

`CHANGELOG.md` is generated from Conventional Commits. Do not hand-edit release entries as source of truth; run `npm run changelog` or the `version` script so changelog content is regenerated from commit history.

Minimum expected coverage:

- config precedence
- bank derivation
- stable document IDs
- append-vs-replace selection
- sanitizer behavior
- queue replay
- import of Pi JSONL sessions
- tool registration and schemas
- recall injection formatting

Before merging or considering a task done, always run:

```bash
npm run check
```

`npm run check` includes `npm run docs:check`, so the normal fast path builds the documentation site, validates internal documentation routes/sidebar entries, and checks generated surface-reference docs. When iterating only on documentation-site content, run the narrower docs path first:

```bash
npm run docs:check
```

Also run coverage and compiler fallback for source, tests, critical paths, or full-CI work:

```bash
npm run check:coverage
npm run typecheck:tsc
```

GitHub PR CI is tiered. Low-impact docs/TUI changes run the fast Ubuntu check by default. Source, tests, critical paths, and `ci:coverage` run coverage and the TypeScript compiler fallback. Runtime-sensitive paths, queue/import/memory-path changes, package/release changes, workflow changes, and `ci:full` run the full Ubuntu/macOS/Windows matrix. Package/release changes and `ci:package` also run package verification. Manual `workflow_dispatch` can run the full matrix for any PR.

If release or package dependencies changed, also run:

```bash
npm run audit:signatures
```

If memory-path behavior changed, also prove the live Hindsight path before merging. Memory-path behavior includes retain payloads, recall queries/formatting, reflect calls, bank selection or creation, queue delivery, import delivery, Adapter transport, smoke helpers, and release packaging that can affect installed runtime behavior.

Preferred proof is a configured-server smoke test:

```bash
npm run smoke:hindsight
```

GitHub Actions has a `Hindsight Integration` workflow that runs for memory-path changes, `memory-path`/`ci:live-smoke` labels, nightly schedule, and manual dispatch. It runs live smoke only when `HINDSIGHT_INTEGRATION_ENABLED=true`; then it uses `HINDSIGHT_BASE_URL` and optional `HINDSIGHT_API_KEY` secrets. Otherwise it skips cleanly. For memory-path PRs, do not treat an unconfigured skip as proof; either run the smoke test locally with credentials, confirm a configured workflow pass, or document why live proof is unavailable and what lower-level checks cover the risk.

## Common mistakes to avoid

- converting the conversation into a summary before retain
- using random UUIDs for each retain update
- storing recalled context back into the transcript
- using metadata instead of tags for scope
- calling retain and then relying on that data in the same response path
- mixing project and global memory without explicit labeling
- letting debug logs expose secrets
- using provider-specific payload rewrites before the default `context` strategy is proven

## Import rules

Historical import is a product feature, not a throwaway script.

When changing importer code:

- preserve deterministic document IDs
- preserve enough provenance for reimport
- default to current-branch import
- make alternate-branch import explicit
- keep import idempotency visible and testable

## Definition of done for this project

A change is done only when:

1. it follows the official Hindsight memory rules
2. it uses documented Pi extension hooks
3. tests cover the changed logic
4. user-visible behavior is documented if changed
5. the diff is minimal and focused
6. no new memory anti-pattern was introduced

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `luxus/pi-hindsight` using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain documentation layout. See `docs/agents/domain.md`.
