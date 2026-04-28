# PR Roadmap

This roadmap is the current implementation guide for `@luxus/pi-hindsight`. It supersedes the older, implementation-phase checklist in `docs/next-changes-plan.md`, which is now useful mainly as historical context.

The goal is to keep the extension simple by default while preserving enough flexibility for real Pi and Hindsight workflows. The roadmap is intentionally ordered so a human or LLM agent can pick the next PR without re-planning the whole project.

## Product line

The extension should be a conservative Pi integration for Hindsight, not a broad memory framework.

The default experience is:

```text
project-only memory
context-hook ephemeral recall
agent_end structured retain
durable queue
stable document IDs
append mode for live sessions
strict repo tags
explicit recall/retain/reflect tools
small command surface
```

Advanced behavior should remain opt-in and inspectable. If a feature makes the default mental model harder, defer it unless it fixes a correctness or safety problem.

## Hindsight invariants

Every PR must preserve these rules:

- Retain raw rich content, preferably structured JSON. Do not pre-summarize conversations before retain.
- Always set `context` on retain items.
- Use stable, meaningful `document_id` values.
- Use `update_mode: "append"` for ongoing live sessions when the server supports it.
- Use `replace` only for deterministic historical imports, rebuilds, or fallback documents that cannot overwrite earlier live deltas.
- Use tags for recall scope and visibility. Use metadata only for provenance and source links.
- Recall before answer generation.
- Keep automatic recall ephemeral by default. Do not persist recalled memory into Pi transcript history.
- Do not retain recalled memory blocks back into Hindsight.
- Do not expect a retain write to be available for recall in the same turn.
- Use `reflect` only for explicit synthesis, not for the baseline automatic recall path.
- Queue retain jobs before network I/O so outages do not lose acknowledged memory intent.
- Sanitize secrets before automatic retain and avoid raw payloads in normal logs or diagnostics.

## Current baseline

Implemented and expected to stay:

- Pi extension entrypoint and package metadata.
- Config resolution from defaults, global config, project config, and environment.
- `project-only`, `project+global`, and `global-only` memory profiles.
- Deterministic project bank derivation and stable live-session document IDs.
- Official Hindsight TypeScript client adapter.
- Bank ensure with mission support.
- Automatic recall through Pi's `context` hook.
- Bank-aware recall query composition with role, turn, max-query, timeout, budget, top-K, and injection-position controls.
- Ephemeral `<hindsight-memory>` injection by default.
- Optional sidecar last-recall snapshot and cleanup command for accidentally persisted recall blocks.
- Automatic retain through Pi's `agent_end` hook.
- Structured retain projection with configurable roles, tool calls, tool results, stripped fields, and secret redaction.
- Durable JSONL retain queue with lock directory, retry limit, and dead-letter queue.
- Queue-first explicit `hindsight_retain` tool.
- Append capability probe and deterministic fallback policy.
- Retain cursor to prevent duplicate append writes from overlapping transcripts.
- Observation scope config and expansion.
- Per-session memory mode, retain toggle, and manual tags.
- Historical import for current session, explicit file, and project-scoped sessions.
- Import dry-run, all-leaves option, manifest, checkpoint, and resume behavior.
- Setup TUI, status, doctor, debug, init, import, flush, session, mode, retain, tag, last-recall, and recall-cleanup commands.
- Local and CI checks plus configured-server smoke path.

## PR sequence

### PR 1: Documentation reset and roadmap alignment

**Status:** next.

**Purpose:** Make README and docs match the implementation that already exists.

**Scope:**

- Add this roadmap.
- Mark `docs/next-changes-plan.md` as historical/superseded.
- Update README status from early scaffold to working MVP/pre-release.
- Add a compact feature-status section with implemented, planned, and deferred items.
- Link README to this roadmap for implementation order.

**Files likely to change:**

- `README.md`
- `docs/pr-roadmap.md`
- `docs/next-changes-plan.md`

**Acceptance criteria:**

- A new contributor can tell what is implemented and what is still planned without reading code.
- An LLM agent can use `docs/pr-roadmap.md` as the next-work source of truth.
- README does not promise unimplemented behavior as finished.

**Checks:**

```bash
npm run format
```

### PR 2: Best-practice regression test pack

**Status:** planned.

**Purpose:** Lock Hindsight best practices into tests so future feature work cannot regress memory correctness.

**Scope:**

Add or tighten tests for:

- raw structured JSON retain payloads, not summaries
- required retain `context`
- stable live `documentId`
- live `append` update mode
- import `replace` semantics only where deterministic
- tag-based project/global scope separation
- metadata used for provenance only
- recalled `<hindsight-memory>` blocks excluded from retain projection
- explicit retain queue-first behavior
- secret redaction before queue write

**Files likely to change:**

- `tests/retain*.test.ts`
- `tests/messages.test.ts`
- `tests/recall*.test.ts`
- `tests/import*.test.ts`
- `tests/memory-scope.test.ts`

**Acceptance criteria:**

- Each invariant in the roadmap has at least one focused test or an explicit note explaining where it is covered.
- Tests fail if recalled memory is retained or if live retain uses unstable IDs.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
```

### PR 3: Minimal configuration pass

**Status:** planned.

**Purpose:** Keep the public mental model small while preserving advanced config.

**Scope:**

- Restructure README configuration docs around profiles first.
- Show a minimal config before the full advanced config.
- Move advanced field explanations into a dedicated section or table.
- Ensure setup TUI labels describe user intent, not internal fields.
- Clarify that `project-only` is the safest default.

**Files likely to change:**

- `README.md`
- `extensions/setup-tui.ts`
- `extensions/config.ts`
- config/setup tests if labels or defaults change

**Acceptance criteria:**

- A user can start with base URL + project bank only.
- Advanced fields remain documented but do not dominate the quick path.
- No default behavior changes unless tests are updated deliberately.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
```

### PR 4: Operational failure-mode hardening

**Status:** planned.

**Purpose:** Make outages and incompatible Hindsight servers boring and diagnosable.

**Scope:**

- Review queue lock timeout behavior under multiple processes.
- Review dead-letter diagnostics and remediation hints.
- Ensure append capability failures produce clear messages.
- Ensure shutdown flush bounds are visible and documented.
- Add tests for corrupt queue lines, stale locks, failed flushes, and unsupported append.

**Files likely to change:**

- `extensions/queue.ts`
- `extensions/capabilities.ts`
- `extensions/retain-durable.ts`
- `extensions/diagnostics.ts`
- `README.md`
- queue/capability tests

**Acceptance criteria:**

- Hindsight down means memory jobs stay on disk.
- Unsupported append cannot silently overwrite previous live memory.
- Doctor/debug tells the user what to do next without showing raw memory content.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
```

### PR 5: Memory quality defaults

**Status:** planned.

**Purpose:** Improve extracted memory quality without increasing everyday config complexity.

**Scope:**

- Review default bank missions for project and global banks.
- Review default observation scopes.
- Document when to change missions, scopes, and recall types.
- Add tests that bank ensure sends the intended missions and observation settings.
- Add smoke-test notes for validating retention quality against a live server.

**Files likely to change:**

- `extensions/config.ts`
- `extensions/bank-operations.ts`
- `extensions/observation-scopes.ts`
- `README.md`
- diagnostics and bank tests

**Acceptance criteria:**

- Project memory extracts repo decisions, constraints, bugs, fixes, and continuity.
- Global memory extracts durable preferences and workflows, not project transcript dumps by default.
- Observation-scope errors are easy to understand.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
npm run smoke:hindsight # when a configured server is available
```

### PR 6: Historical import UX final pass

**Status:** planned.

**Purpose:** Make old-session import safe enough for real use.

**Scope:**

- Review dry-run output for usefulness before writing.
- Confirm project-session discovery is narrow and safe.
- Confirm all-leaves import is explicit.
- Confirm manifest/checkpoint/resume behavior is visible in debug.
- Add examples for preview, current import, file import, and project import.

**Files likely to change:**

- `extensions/import-*.ts`
- `extensions/memory-operations.ts`
- `extensions/commands.ts`
- `README.md`
- import tests

**Acceptance criteria:**

- User can preview exactly what will be written.
- Re-running import is deterministic and does not create random duplicate documents.
- Branch import behavior is explicit.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
```

### PR 7: Release readiness

**Status:** planned.

**Purpose:** Prepare a small public release without adding features.

**Scope:**

- Verify package files and extension entrypoint.
- Verify README install instructions.
- Run full checks and live smoke where available.
- Regenerate changelog from Conventional Commits.
- Confirm no local-only paths remain in docs except development examples.
- Confirm secrets and generated files are ignored.

**Files likely to change:**

- `README.md`
- `CHANGELOG.md`
- `package.json`
- `.npmignore` or package `files` if needed
- CI workflow docs if needed

**Acceptance criteria:**

- Package can be installed by path and from npm tarball.
- README describes pre-release status honestly.
- Release check commands pass or documented live-server smoke is delegated to CI.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
npm run smoke:hindsight # when available
npm pack --dry-run
```

## Deferred ideas

These are intentionally not in the near-term PR sequence:

- Persisting recalled memories into Pi transcript history.
- Linked hosts or multi-Hindsight-server routing.
- Cached recall context.
- Hashtag-based controls such as `#nomem`.
- Generic memory-backend abstractions.
- Automatic mental-model management.
- Bank administration UI beyond setup guidance.
- OpenClaw-style multitenant dynamic routing.
- Large prompt-template or skill bundles.

## LLM handoff rules

When an LLM agent continues this work:

1. Pick the earliest PR whose status is `next` or `planned` and whose prerequisites are done.
2. Keep the PR small. Do not combine unrelated roadmap items.
3. Preserve all Hindsight invariants above.
4. Update README only for user-visible behavior.
5. Add or update tests for memory routing, IDs, queueing, retain payloads, recall injection, or import behavior.
6. Run `npm run check` and `npm run typecheck:tsc` before calling the PR done.
7. If live Hindsight behavior changed, also run `npm run smoke:hindsight` when credentials are available.
8. Do not add deferred ideas unless the user explicitly reopens scope.
