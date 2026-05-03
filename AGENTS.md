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

Before merging or considering a task done, run:

```bash
npm run check
npm run check:coverage
npm run typecheck:tsc
```

If live Hindsight integration behavior changed, also run the configured-server smoke test when credentials are available:

```bash
npm run smoke:hindsight
```

GitHub Actions has a `Hindsight Integration` workflow that runs on PRs, nightly schedule, and manual dispatch. It runs live smoke only when `HINDSIGHT_INTEGRATION_ENABLED=true`; then it uses `HINDSIGHT_BASE_URL` and optional `HINDSIGHT_API_KEY` secrets. Otherwise it skips cleanly.

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
