# Next Changes Plan: Hindsight Depth and Pi Memory Governance

> **Historical note:** This file records an earlier implementation-phase plan. Most items in this checklist have since been implemented. Use [`docs/pr-roadmap.md`](pr-roadmap.md) as the current source of truth for remaining PR order, acceptance criteria, and LLM handoff rules.

## Purpose

This plan converts the latest architecture review into a practical implementation roadmap for `luxus/pi-hindsight`.

The goal is not to copy OpenClaw or `noctuid/pi-hindsight` wholesale. The goal is to keep this repository's current strength—clean Pi-specific module boundaries—while adding the Hindsight-native depth and Pi session controls that the review identified as missing.

## Guiding principles

1. Preserve the current architecture shape.
   - `extensions/index.ts` stays a thin Pi adapter.
   - `memory-lifecycle.ts` owns policy sequencing, not every helper.
   - `memory-operations.ts` exposes shared intent operations for tools and commands.
   - identity, scope, queueing, retain projection, diagnostics, setup, and import stay in focused modules.

2. Fix correctness before feature expansion.
   - Explicit retain must be durable.
   - Queue locking must not corrupt or discard jobs.
   - Append mode must not silently overwrite memory on incompatible Hindsight servers.
   - Recall must not slow or block Pi indefinitely.

3. Keep defaults conservative.
   - Recall remains ephemeral by default.
   - Retain stores raw structured content, not summaries.
   - Project recall remains repo-scoped.
   - Global recall remains explicitly non-repo scoped.
   - Session controls should make memory easier to reason about, not magical.

4. Add Hindsight-native features intentionally.
   - Bank mission support improves extraction quality.
   - Observation scopes improve cross-session consolidation if supported by the client/API.
   - Capability detection prevents version drift from causing memory loss.

5. Build each feature with tests and diagnostics.
   - Every new config field must be normalized and visible in safe debug output where useful.
   - Every behavior that changes memory routing, document IDs, queueing, or recall injection needs tests.

## Current baseline

The repository already has:

- package scaffold and Pi extension entrypoint
- config resolution from defaults, global config, project config, and environment
- deterministic project bank derivation
- stable live-session document IDs
- Hindsight client adapter
- automatic recall through Pi's `context` hook
- automatic retain queueing through Pi's `agent_end` hook
- best-effort queue flush on shutdown
- retain cursoring to avoid duplicate appends
- explicit memory tools
- diagnostics, status, setup, init, import, and flush commands
- import parser/branch/manifest modules
- smoke test script
- broad tests for current MVP behavior

The review identified the most important gaps:

1. Explicit retain still calls Hindsight directly and bypasses the durable queue.
2. Queue stale-lock detection uses the waiting caller's elapsed time instead of the lock owner's `acquiredAt`.
3. Shutdown flush is intentionally tiny but not clearly configurable or reported.
4. Append capability is assumed rather than detected.
5. Recall lacks timeout/topK/max-query/role controls.
6. Bank missions are not first-class.
7. Observation scopes are not first-class.
8. Retain projection policy is too blunt.
9. Per-session memory mode and manual tags are missing.
10. Import/backfill workflows need dry-run, preview, resume, and checkpointing.
11. Setup should grow profiles for Cloud, external/local API, and local `hindsight-embed` guidance.

## Release strategy

Use small focused pull requests. Each PR should have a narrow user-visible behavior change and matching tests.

Recommended order:

1. PR 1: Durable explicit retain.
2. PR 2: Queue lock hardening and shutdown flush bounds.
3. PR 3: Append capability detection and fallback policy.
4. PR 4: Recall controls and timeout.
5. PR 5: Bank mission support.
6. PR 6: Observation scope config and expansion.
7. PR 7: Rich retain projection policy.
8. PR 8: Session memory metadata, modes, and tags.
9. PR 9: Session pattern rules.
10. PR 10: Import dry-run and preview.
11. PR 11: Import resume and checkpointing.
12. PR 12: Project session import workflows.
13. PR 13: Setup profiles.
14. PR 14: SecretRef-style API key config.
15. PR 15: Smoke, doctor, docs, and recall debug display.

PRs 1 and 2 are correctness hardening and should happen first. PRs 3 and 4 reduce memory loss and UX risk. PRs 5 through 9 improve memory quality and governance. PRs 10 through 15 improve operations and adoption.

## Explicit deferrals

These review ideas are intentionally deferred out of this roadmap so the next PRs stay small:

- Route banks through `banks.routes[]`. Project/global banks plus session governance should stabilize first. Add route banks later only when real health, people, temporary, or read-only bank use cases exist.
- Full OpenClaw-style dynamic bank routing by agent, provider, channel, and user. Pi does not currently need that multitenant model.
- Persisted recall messages. Recall remains ephemeral by default; debug display should use in-memory or sidecar debug state, not provider-visible transcript entries.

---

# Phase 1: Correctness hardening

## PR 1: Durable explicit retain

### Problem

Automatic retain writes a `RetainJob` to disk before network flush. Explicit retain currently calls `client.retain(...)` directly from `memory-operations.ts`. If Hindsight is down, a manual memory write can be lost even though automatic memory is durable.

This violates the project invariant that retain jobs are durably queued before network flush.

### Target behavior

All retain paths that represent user intent should queue first:

- automatic retain from `agent_end`
- explicit `hindsight_retain` tool
- future explicit retain commands

The tool should return a result that makes durability visible:

```ts
type DurableRetainResult = {
  bankId: string;
  tags: string[];
  documentId: string;
  enqueued: boolean;
  sent: number;
  remaining: number;
  deadLettered: number;
};
```

Use `enqueued` for the durable-write result so it is clear that the job first landed on disk. Existing callers may map that to their current `queued` field while the public surface is kept backward compatible.

When Hindsight is reachable, the implementation can enqueue and then immediately attempt a flush. When Hindsight is down, the job remains on disk and the tool returns an enqueued result instead of throwing away the memory.

### Files to add

- `extensions/retain-durable.ts`
- `tests/retain-durable.test.ts`

### Files likely to change

- `extensions/memory-operations.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/retain.ts`
- `extensions/queue.ts` if job creation helpers belong near queue types
- `extensions/types.ts`
- `tests/tools.test.ts` or existing tool tests if present
- `tests/extension-hooks.test.ts`
- `README.md`

### Proposed API

```ts
export type DurableRetainSource = "auto" | "tool" | "command" | "import";

export interface RetainDurablyArgs {
  cwd: string;
  sessionFile?: string;
  config: ResolvedConfig;
  client: HindsightLikeClient;
  bankId: string;
  content: string;
  context: string;
  tags: string[];
  documentId: string;
  updateMode: UpdateMode;
  metadata?: Record<string, string>;
  source: DurableRetainSource;
  timestamp?: string;
}

export interface RetainDurablyResult {
  enqueued: boolean;
  sent: number;
  remaining: number;
  deadLettered: number;
}

export async function retainDurably(args: RetainDurablyArgs): Promise<RetainDurablyResult>;
```

### Implementation details

`retainDurably` should:

1. Resolve queue path from `cwd` and `config.retain.queuePath`.
2. Redact content if `config.retain.redactSecrets` is true.
3. Build a `RetainJob` with stable fields:
   - `id`
   - `bankId`
   - `createdAt`
   - `documentId`
   - `updateMode`
   - `item.content`
   - `item.context`
   - `item.timestamp`
   - `item.async`
   - `item.tags`
   - `item.metadata`
   - `retries: 0`
4. Enqueue the job before network I/O.
5. Attempt a flush unless retain config later adds a no-immediate-flush option.
6. Return queue/flush counts.

Metadata should include source provenance without leaking content:

```ts
metadata: {
  source: "pi-hindsight",
  retainSource: args.source,
  ...args.metadata,
}
```

If `flushRetainQueue` fails unexpectedly, the function should not remove the queued job. It should return `enqueued: true` and surface enough error/status data through caller-friendly messaging or diagnostics. Do not log raw content.

### Automatic retain migration

Automatic retain currently already creates queue jobs. This PR can either:

1. Leave automatic retain unchanged and use `retainDurably` only for explicit retain first, or
2. Move automatic retain through `retainDurably` in the same PR.

Preferred approach: use `retainDurably` for explicit retain first, then migrate automatic retain only if the diff stays small. The invariant matters more than perfect deduplication in the first PR.

### Tests

Add tests for:

- explicit retain queues when `client.retain` throws
- explicit retain returns queue status when server is down
- later `flushRetainQueue` sends the queued explicit job
- explicit retain merges base tags with caller-provided tags
- explicit retain redacts secrets before enqueueing
- explicit retain uses stable explicit document ID:
  - `pi-explicit:${stableSessionId(sessionFile, cwd)}`
- explicit retain uses `updateMode: "append"`
- explicit retain metadata marks source as `tool`

### Acceptance criteria

- `hindsight_retain` no longer calls `client.retain` directly.
- Server outage during explicit retain leaves a job in `.pi/hindsight/retain-queue.jsonl`.
- Queue flush later sends the same job.
- No raw content appears in normal status/debug output.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 2: Queue lock hardening and shutdown flush bounds

### Problem

The queue uses an in-process mutex plus a lock directory, which is the right shape. However, stale-lock detection currently compares `Date.now() - started`, where `started` belongs to the waiting caller. That means a valid active lock can be treated as stale by a process that waited longer than `LOCK_STALE_MS`.

The stale decision should be based on the lock owner's timestamp.

Shutdown flushing is also intentionally bounded today (`maxJobs: 1`) but not configurable or clearly reported. This PR should make that bound explicit so a normal shutdown does not look like a silent failed drain.

### Target behavior

A waiting process should only remove a lock when the lock owner's `acquiredAt` is stale.

```ts
type QueueLockOwner = {
  pid?: number;
  acquiredAt?: string;
};
```

Stale calculation:

```ts
const acquiredAtMs = Date.parse(owner.acquiredAt ?? "");
const stale = !Number.isFinite(acquiredAtMs) || now - acquiredAtMs > RETAIN_QUEUE_LOCK.staleMs;
```

The waiting caller's elapsed time should control only timeout errors, not stale ownership.

Add shutdown flush config:

```json
{
  "retain": {
    "shutdownFlushMaxJobs": 10,
    "shutdownFlushTimeoutMs": 2000
  }
}
```

Shutdown should attempt at most `shutdownFlushMaxJobs` jobs and stop on first failure. If jobs remain, status/debug should make the bound explicit:

```text
Queue has remaining jobs; shutdown flush is intentionally bounded.
```

### Files to add

- `tests/queue-lock.test.ts` if existing queue tests are not enough

### Files likely to change

- `extensions/queue.ts`
- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/diagnostics.ts`
- `README.md`
- existing queue tests

### Implementation details

Add helper functions to make behavior testable:

```ts
export interface QueueLockOwner {
  pid?: number;
  acquiredAt?: string;
}

export function isQueueLockOwnerStale(
  owner: QueueLockOwner | undefined,
  now = Date.now(),
  staleMs = RETAIN_QUEUE_LOCK.staleMs,
): boolean;
```

Add owner reading:

```ts
async function readQueueLockOwner(lockPath: string): Promise<QueueLockOwner | undefined>;
```

When lock exists:

1. Read `${lockPath}/owner`.
2. If owner is missing, malformed, or timestamp is invalid, treat as stale.
3. If owner age exceeds stale threshold, remove lock.
4. Otherwise wait until retry or timeout.
5. If waiter exceeds timeout, throw `Timed out waiting for retain queue lock ...`.

PID liveness checks are optional. If added, they must be portable and must not create false stale decisions. Timestamp-only is acceptable for this PR.

### Tests

Add tests for:

- fresh lock is not stale even if waiter has waited nearly timeout length
- stale owner timestamp is stale
- missing owner file is stale
- malformed owner file is stale
- invalid `acquiredAt` is stale
- waiting process does not remove a fresh active lock
- concurrent enqueue and flush preserve all jobs
- shutdown flush respects `shutdownFlushMaxJobs`
- debug/status reports remaining queue after bounded shutdown behavior

### Acceptance criteria

- Stale decision uses owner timestamp, not waiter timestamp.
- Queue lock helper has direct unit tests.
- Existing queue replay tests still pass.
- Shutdown flush bounds are configurable and documented.
- Remaining queue after shutdown is not misleading.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## Phase 1 lifecycle seam guardrail

PR 1 and PR 2 may touch `memory-lifecycle.ts`. Keep lifecycle focused on policy sequencing. If these PRs make lifecycle harder to read, extract only the seams that now have real leverage:

```text
retain-cursor-policy.ts
  newRetainMessages()
  markRetainedMessages()

status-policy.ts
  setMemoryStatus()
  notifyMemoryFailure()
```

Do not split lifecycle preemptively. Use the deletion test: extract only if deleting the helper would force cursor/status rules back into multiple callers.

---

## PR 3: Append capability detection and fallback policy

### Problem

The extension assumes Hindsight supports `updateMode: "append"`. Current Hindsight likely does, but older or custom deployments may not. If append is unsupported, stable session document IDs could cause overwrites or failed writes.

OpenClaw detects append support. This extension should also detect it, but with Pi-friendly defaults.

### Target behavior

Add Hindsight capability detection:

```ts
export interface HindsightCapabilities {
  version?: string;
  appendUpdateMode: boolean;
  checkedAt: string;
  error?: string;
}
```

Add retain fallback policy:

```ts
type AppendFallback = "error" | "per-turn-documents";
```

Default should be:

```json
{
  "retain": {
    "appendFallback": "error"
  }
}
```

Behavior:

- If append is supported: use stable session document ID and `updateMode: "append"`.
- If append is unsupported and fallback is `error`: retain refuses clearly and diagnostics report the issue.
- If append is unsupported and fallback is `per-turn-documents`: use unique deterministic per-turn or per-delta document IDs so prior content is not overwritten.

### Files to add

- `extensions/capabilities.ts`
- `tests/capabilities.test.ts`

### Files likely to change

- `extensions/client.ts`
- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/retain-durable.ts`
- `extensions/diagnostics.ts`
- `extensions/memory-operations.ts`
- `scripts/smoke-hindsight.mjs`
- `README.md`

### Capability probe options

Prefer official client/API behavior if available. Confirm exact support in the Hindsight TypeScript client before implementing.

Possible approaches:

1. Dedicated server/version/capabilities endpoint if exposed.
2. Client method if exposed.
3. Safe probe retain into a test document and inspect result.
4. Conservative unknown state if probe cannot be performed.

Avoid inventing undocumented Hindsight request shapes. If the SDK does not expose capability discovery, implement a minimal safe probe behind clear naming and tests.

Probe side-effect rules:

- Prefer a dedicated capability endpoint or client method over writes.
- If a write probe is required, use a smoke/probe-specific bank or document ID, never the normal project live-session document.
- Tag probe data with `source:pi`, `test:capability`, and `feature:append-probe`.
- Use deterministic probe document IDs so repeated probes do not create unbounded junk.
- Clean up only if official API support exists; otherwise make probe content obviously harmless and excluded from normal project recall.

### Config shape

```ts
retain: {
  appendFallback: "error" | "per-turn-documents";
}
```

### Diagnostics

Expose capability state in:

- `/hindsight:doctor`
- `/hindsight:debug`
- `hindsight_recall` or status only when relevant failures happen
- smoke test output

Example debug section:

```text
Capabilities:
- append update mode: supported
- checked at: 2026-04-27T12:00:00.000Z
```

If unsupported:

```text
Capabilities:
- append update mode: unsupported
- retain fallback: error
- action: upgrade Hindsight or set retain.appendFallback to per-turn-documents
```

### Tests

Add tests for:

- append supported returns `appendUpdateMode: true`
- append unsupported returns `appendUpdateMode: false`
- unsupported append + fallback `error` prevents retain with clear error
- unsupported append + fallback `per-turn-documents` changes document ID strategy
- doctor/debug include capability state without secrets
- capability probe does not pollute normal project recall scope

### Acceptance criteria

- Append support is no longer silently assumed.
- User gets actionable diagnostics when append is unavailable.
- No unsupported server can silently overwrite stable live session docs.
- Capability probing is isolated from normal project memory.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 4: Recall controls and timeout

### Problem

Recall currently has budget, max tokens, types, and recent turn count. The review identified missing controls that affect latency, cost, and relevance:

- timeout
- top K
- max query chars
- roles used for query composition
- context turns naming consistency

### Target behavior

Add config:

```json
{
  "recall": {
    "roles": ["user", "assistant"],
    "contextTurns": 1,
    "maxQueryChars": 800,
    "topK": 8,
    "timeoutMs": 10000,
    "injectionPosition": "append"
  }
}
```

Keep `injectionMode: "context"` and ephemeral injection as the only supported default path.

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/recall.ts` or equivalent recall formatting/query module
- `extensions/client.ts`
- `extensions/diagnostics.ts`
- `extensions/setup-tui.ts`
- `README.md`
- recall tests

### Config compatibility

Current config has:

```ts
recentTurnsForQuery: number;
```

Options:

1. Keep `recentTurnsForQuery` as compatibility alias and introduce `contextTurns`.
2. Rename fully and support old config during normalization.

Preferred: support both during normalization, document `contextTurns` as the future field.

### Timeout behavior

Recall timeout should degrade gracefully:

- Pi continues without injected memory.
- Status records recall timeout/failure.
- Optional notification uses configured notification behavior.
- No raw query or recalled facts are logged unless debug config explicitly allows.

Implementation options:

- Use `AbortSignal.timeout(...)` if the Hindsight client supports signals.
- Wrap promise with timeout if not.

If the underlying request cannot be canceled, still stop waiting and ignore late result.

### Query composition behavior

Add a query builder policy:

```ts
export interface RecallQueryPolicy {
  roles: Array<"user" | "assistant" | "tool" | "system">;
  contextTurns: number;
  maxQueryChars: number;
}
```

Rules:

- Include only configured roles.
- Prefer recent user intent over old assistant output.
- Truncate deterministically at `maxQueryChars`.
- Avoid including injected Hindsight memory.
- Avoid including tool results unless explicitly enabled later.

### Client options

If the Hindsight SDK supports top K, pass it through. If not, document unsupported state and keep config ready for future SDK.

Do not invent request shape fields if unsupported.

### Tests

Add tests for:

- recall timeout returns no memory block and records failure status
- query builder respects roles
- query builder respects context turn count
- query builder truncates to max chars
- project recall still uses repo scope tags
- global recall still uses `source:pi`
- topK is passed only if supported by client adapter

### Acceptance criteria

- Recall has bounded latency.
- Recall query size is bounded.
- Recall query role selection is deterministic.
- Existing ephemeral injection behavior remains default.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

# Phase 2: Memory-quality features

## PR 5: Bank mission support

### Problem

Hindsight bank missions help extraction and reflection quality. OpenClaw exposes a bank mission/profile field. This extension currently ensures banks but does not expose first-class mission configuration.

### Target behavior

Add mission config for project and global banks:

```json
{
  "banks": {
    "project": {
      "mission": "Memory for this Pi coding project. Extract architecture decisions, bugs, fixes, constraints, durable preferences, and project continuity."
    },
    "global": {
      "enabled": true,
      "mission": "Cross-project memory for durable user preferences, recurring workflows, coding habits, and stable assistant behavior."
    }
  }
}
```

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/banking.ts`
- `extensions/client.ts`
- `extensions/diagnostics.ts`
- `extensions/setup-tui.ts`
- `README.md`
- bank tests

### Implementation details

Confirm exact Hindsight SDK field names before coding. Possible names may include `mission`, `reflectMission`, or profile fields. Use official client types/API behavior as source of truth.

Bank ensure should:

1. Create bank if missing.
2. Upsert mission/profile if configured and supported.
3. Report unsupported mission behavior clearly if client/API lacks support.
4. Avoid overwriting mission when config does not specify one.

### Diagnostics

Doctor/debug should show:

- project bank mission configured: yes/no
- global bank mission configured: yes/no
- mission upsert supported: yes/no/unknown

Do not print full mission unless debug output is explicitly allowed to include it. Missions can reveal project context.

### Tests

Add tests for:

- configured project mission is passed to bank creation/upsert
- configured global mission is passed when global bank enabled
- no mission is sent when missing
- unsupported mission capability is reported without failing unrelated recall/retain
- config normalization preserves mission strings

### Acceptance criteria

- Project/global bank mission config exists.
- Bank creation/upsert uses official SDK-supported fields.
- Diagnostics expose mission support state.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 6: Observation scope config and expansion

### Problem

Hindsight observations can consolidate durable insights across sessions. The review notes that `noctuid/pi-hindsight` treats observation scopes as a core setting. This extension does not currently expose observation scopes.

### Target behavior

Add config:

```json
{
  "observations": {
    "enabled": true,
    "scopes": [["harness:pi"], ["repo:{repoKey}"], ["user:{userId}", "repo:{repoKey}"]]
  }
}
```

Placeholders should expand through identity code.

Supported placeholders:

- `{repoKey}`
- `{sessionId}`
- `{cwdHash}`
- `{projectBankId}`
- `{userId}` if available/configured
- `{branch}` if available

### Files to add

- `extensions/observation-scopes.ts`
- `tests/observation-scopes.test.ts`

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/memory-identity.ts`
- `extensions/retain-durable.ts`
- `extensions/diagnostics.ts`
- `README.md`

### Implementation details

Start with deterministic expansion and validation before wiring to retain requests. Do not invent Hindsight request fields.

Implementation stages:

1. Add config and validation.
2. Add placeholder expansion.
3. Add diagnostics showing resolved observation scopes.
4. Check official Hindsight SDK support for observation scope fields.
5. If supported, attach to retain request metadata/options using official field names.
6. If unsupported, document that scopes are configured but not sent yet, or map conservatively to tags only if that matches official behavior.

### Validation rules

- Each scope must be a non-empty string array.
- Unknown placeholders should fail config validation or normalize to disabled with warning diagnostics.
- Empty expanded strings are invalid.
- Duplicates should be removed deterministically.

### Tests

Add tests for:

- deterministic placeholder expansion
- unknown placeholder rejection
- duplicate scope cleanup
- disabled observations produce no scopes
- configured scopes appear in debug/doctor
- retain request carries observation scope data only when supported

### Acceptance criteria

- Observation scope config is explicit.
- Scope expansion is deterministic and tested.
- Unsupported SDK/API behavior is not guessed.
- If SDK/API support is unclear, the PR may stop at config, expansion, validation, and diagnostics; request wiring can be deferred.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 7: Rich retain projection policy

### Problem

Current retain config only supports:

```ts
includeToolResults: "meaningful-only" | "all" | "none";
```

That is too blunt. Tool output can be valuable, noisy, huge, or sensitive. Retain policy needs role/content selection, tool filtering, and strip rules.

### Target behavior

Add a richer policy:

```json
{
  "retain": {
    "content": {
      "user": ["text"],
      "assistant": ["text", "toolCall"],
      "toolResult": ["error"]
    },
    "toolFilter": {
      "toolCall": {
        "exclude": ["hindsight_retain", "hindsight_recall", "hindsight_reflect"]
      },
      "toolResult": {
        "exclude": [
          "hindsight_retain",
          "hindsight_recall",
          "hindsight_reflect",
          "read",
          "grep",
          "find",
          "ls"
        ]
      }
    },
    "strip": {
      "message": ["usage", "cost", "responseId"],
      "topLevel": ["id", "parentId"]
    }
  }
}
```

Keep `includeToolResults` as a deprecated compatibility shorthand.

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/retain.ts`
- `extensions/sanitize.ts`
- `extensions/diagnostics.ts`
- `README.md`
- retain tests

### Proposed types

```ts
type RetainUserContent = "text";
type RetainAssistantContent = "text" | "toolCall" | "thinking";
type RetainToolResultContent = "error" | "summary" | "content";

interface RetainContentConfig {
  user: RetainUserContent[];
  assistant: RetainAssistantContent[];
  toolResult: RetainToolResultContent[];
}

interface ToolNameFilter {
  include?: string[];
  exclude?: string[];
}

interface RetainToolFilterConfig {
  toolCall: ToolNameFilter;
  toolResult: ToolNameFilter;
}

interface RetainStripConfig {
  message: string[];
  topLevel: string[];
}
```

### Compatibility mapping

Current `includeToolResults` should map like this:

- `none` -> `toolResult: []`
- `meaningful-only` -> `toolResult: ["error"]`
- `all` -> `toolResult: ["error", "summary", "content"]`

Do not remove old config immediately.

### Default policy

Defaults should be conservative:

- retain user text
- retain assistant text
- retain assistant tool call names/arguments only if not Hindsight tools
- retain tool result errors by default
- exclude large file reads/search results by default
- never recursively retain Hindsight recall/retain/reflect tool outputs

### Tests

Add tests for:

- default policy excludes Hindsight tools recursively
- default policy excludes noisy tool results
- tool result errors are retained by default
- `includeToolResults` compatibility mapping works
- configured include/exclude lists behave deterministically
- strip config removes configured fields
- sanitizer still redacts secrets after projection

### Acceptance criteria

- Retain projection is configurable without losing safe defaults.
- Old config still works.
- Hindsight tools do not recursively retain their own memory operations.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

# Phase 3: Pi session governance

## PR 8: Session memory metadata, modes, and tags

### Problem

The extension has project/global config but lacks first-class per-session governance. The review recommends borrowing `noctuid/pi-hindsight`'s session control ideas without relying on prompt hashtags.

### Target behavior

Add per-session memory metadata:

```ts
export interface HindsightSessionMeta {
  retained: boolean;
  recallMode: "normal" | "off";
  retainMode: "normal" | "off";
  mode: "normal" | "read-only" | "ignored";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

Modes:

| Mode        | Recall | Retain |
| ----------- | ------ | ------ |
| `normal`    | yes    | yes    |
| `read-only` | yes    | no     |
| `ignored`   | no     | no     |

Commands:

```text
/hindsight:session
/hindsight:retain on
/hindsight:retain off
/hindsight:tag add <tag>
/hindsight:tag remove <tag>
/hindsight:mode normal
/hindsight:mode read-only
/hindsight:mode ignored
```

### Files to add

- `extensions/session-memory-meta.ts`
- `tests/session-memory-meta.test.ts`

### Files likely to change

- `extensions/commands.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/memory-identity.ts`
- `extensions/types.ts`
- `extensions/diagnostics.ts`
- `.gitignore`
- `README.md`

### Storage options

Preferred: use a Pi custom session entry if documented and stable. If not, use a sidecar file keyed by session ID:

```text
.pi/hindsight/session-meta/<stableSessionId>.json
```

Do not store metadata in messages that get sent to the LLM. Do not persist recalled memory into transcript history.

Git ignore policy:

- Sidecar session metadata is runtime state and should be ignored, for example `.pi/hindsight/session-meta/`.
- Project config remains `.pi/hindsight.json`; decide per repository whether to track it. Do not hide that decision by ignoring all `.pi/` blindly.
- Any new runtime state path added by this PR must be listed in `.gitignore` or documented as intentionally tracked.

### Effective mode rules

Effective session mode should combine:

1. global/project config enabled flags
2. session metadata mode
3. future session pattern rules

Initial rules:

- If extension disabled: no recall, no retain.
- If mode `ignored`: no recall, no retain.
- If mode `read-only`: recall yes, retain no.
- If mode `normal`: normal config gates apply.
- `/hindsight:retain off` should set retain mode off or mode read-only depending on UX decision.

### Tags

Manual session tags should merge with base tags for retain. They should not replace required base tags like `source:pi`, repo tags, or session tags.

Tag validation:

- non-empty
- no control characters
- reasonable max length
- deterministic de-duplication

### Tests

Add tests for:

- normal session recalls and retains
- read-only session recalls but does not retain
- ignored session does neither
- manual tags merge with base tags
- invalid tags are rejected
- session metadata persists across reload
- status/debug show effective mode without leaking content
- sidecar metadata path is ignored or explicitly documented as tracked

### Acceptance criteria

- User can control memory behavior per session.
- Session controls do not rely on prompt hashtags.
- Modes affect lifecycle recall/retain gates.
- Manual tags merge safely with base tags.
- Runtime metadata storage has an explicit `.gitignore` policy.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 9: Session pattern rules

### Problem

Per-session commands are useful, but automated workflows need config-driven rules. OpenClaw supports ignored/stateless session patterns. Pi needs a smaller, explicit version.

### Target behavior

Add config:

```json
{
  "sessions": {
    "ignorePatterns": ["*:cron:*", "*:scratch:*"],
    "readOnlyPatterns": ["*:subagent:*", "*:review:*"],
    "skipRecallForReadOnly": false
  }
}
```

Effective modes:

- ignore pattern -> `ignored`
- read-only pattern -> `read-only`
- explicit session metadata should override or be overridden by patterns based on a documented precedence rule

Recommended precedence:

1. `ignored` config pattern wins for safety.
2. explicit session mode wins over read-only pattern.
3. read-only pattern applies when no explicit session mode exists.
4. default normal.

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/session-memory-meta.ts`
- `extensions/memory-lifecycle.ts`
- `extensions/diagnostics.ts`
- `README.md`

### Pattern grammar

Keep grammar simple:

- glob-like `*` wildcard only
- match against known session key string
- no full regex in MVP

Session key candidates:

- session file path
- session ID
- cwd/repo key
- optional Pi session metadata if exposed

Document exact matching target.

### Tests

Add tests for:

- ignored pattern disables recall/retain
- read-only pattern disables retain
- `skipRecallForReadOnly` disables recall for read-only sessions when true
- explicit ignored mode cannot be bypassed accidentally
- glob matching is deterministic

### Acceptance criteria

- Automated/specialist sessions can be made read-only or ignored by config.
- Pattern grammar is documented and small.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

# Phase 4: Import/backfill maturity

## PR 10: Import dry-run and preview

### Problem

Historical import is already a product feature, but operators need to see what will be retained before writing memory.

### Target behavior

Add command/tool options:

```text
/hindsight:import --dry-run
/hindsight:import --preview
/hindsight:import --all-leaves
```

Output should include:

- document ID
- branch
- message count
- approximate content size
- tags
- update mode
- bank ID
- whether it would replace or append

Dry-run must write nothing to Hindsight and should not mutate manifest except maybe a clearly separate preview cache. Preferred: no writes at all.

### Files likely to change

- `extensions/import-sessions.ts`
- `extensions/import-parser.ts`
- `extensions/import-branches.ts`
- `extensions/import-manifest.ts`
- `extensions/tools.ts`
- `extensions/commands.ts`
- `README.md`
- import tests

### Tests

Add tests for:

- dry-run writes nothing to client
- dry-run does not update manifest
- preview contains deterministic document IDs
- preview shows branch/message count/size/tags
- all-leaves mode previews all selected branches

### Acceptance criteria

- User can safely inspect import impact before writing memory.
- Dry-run has no side effects.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 11: Import resume and checkpointing

### Problem

Long imports need restart safety. OpenClaw supports backfill checkpoint/resume. This extension has an import manifest, but needs explicit checkpoint behavior.

### Target behavior

Add config:

```json
{
  "import": {
    "checkpointPath": ".pi/hindsight/import-checkpoint.json",
    "resume": true
  }
}
```

Track per-document status:

```ts
type ImportDocumentStatus = "pending" | "completed" | "failed" | "skipped";
```

Checkpoint should include:

- import run ID
- source session file
- bank ID
- document IDs
- status per document
- error per failed document
- timestamps

Checkpoint files are runtime state. Add `.pi/hindsight/import-checkpoint.json` to `.gitignore` unless a repository intentionally chooses to track import state for a reproducible migration.

### Files likely to change

- `extensions/import-sessions.ts`
- `extensions/import-manifest.ts`
- `extensions/types.ts`
- `extensions/config.ts`
- `.gitignore`
- `README.md`
- import tests

### Tests

Add tests for:

- interrupted import resumes completed docs without duplicates
- failed docs remain pending or failed according to policy
- resume skips completed docs
- checkpoint is deterministic and redacted
- checkpoint path has explicit `.gitignore` behavior
- manifest records completed/failed/skipped separately

### Acceptance criteria

- Import can resume after interruption.
- Completed documents are not duplicated.
- Failed documents remain visible and actionable.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 12: Project session import workflows

### Problem

Noctuid treats old sessions as first-class. This extension should support project-scoped historical import without accidentally importing unrelated user history.

### Target behavior

Add commands:

```text
/hindsight:import-current
/hindsight:import-file <path>
/hindsight:import-project-sessions --dry-run
```

Project session import should only include sessions associated with the current repo/cwd. Avoid broad globs that import unrelated sessions.

### Files likely to change

- `extensions/commands.ts`
- `extensions/import-sessions.ts`
- `extensions/session.ts`
- `README.md`
- tests

### Tests

Add tests for:

- current session import uses current session file
- explicit file import validates path
- project session discovery filters to current repo
- dry-run for project sessions writes nothing

### Acceptance criteria

- Current and explicit session import are ergonomic.
- Project import remains scoped to current repo.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

# Phase 5: Setup and operational polish

## PR 13: Setup profiles

### Problem

OpenClaw's setup wizard is stronger. This extension has good project-local setup, but should guide common deployment modes.

### Target behavior

Extend `/hindsight:setup` with profiles:

1. Hindsight Cloud.
2. Existing local/external Hindsight API.
3. Local `hindsight-embed` profile guidance.

For local `hindsight-embed`, first version should guide rather than daemon-manage:

```bash
uvx hindsight-embed@latest profile create pi --port 8888
uvx hindsight-embed@latest -p pi bank create pi-project-...
uvx hindsight-embed@latest -p pi ui start
```

### Files likely to change

- `extensions/setup-tui.ts`
- `extensions/config-writer.ts`
- `extensions/types.ts`
- `README.md`
- setup tests if present

### Acceptance criteria

- Setup flow helps user choose Cloud/external/local profile.
- Local profile guidance avoids undocumented daemon management.
- Project config remains explicit and inspectable.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 14: SecretRef-style API key config

### Problem

API keys should not be written to `.pi/hindsight.json` by default. OpenClaw supports SecretRef modes. Pi can use a simpler version.

### Target behavior

Add config shape:

```json
{
  "hindsight": {
    "apiKey": {
      "source": "env",
      "name": "HINDSIGHT_API_KEY"
    }
  }
}
```

Possible future sources:

- `env`
- `file`
- `exec`

MVP should start with `env` only unless file/exec are needed immediately.

### Compatibility

Current config and env behavior should keep working:

- `HINDSIGHT_API_KEY` env override works.
- Existing direct `apiKey` string config, if supported, should be read but never written by setup unless user explicitly opts in.

### Files likely to change

- `extensions/types.ts`
- `extensions/config.ts`
- `extensions/config-writer.ts`
- `extensions/setup-tui.ts`
- `extensions/diagnostics.ts`
- `README.md`
- config tests

### Tests

Add tests for:

- env SecretRef resolves API key
- direct env override wins according to documented precedence
- safe config redacts source and never prints secret value
- setup writes env reference rather than raw secret by default

### Acceptance criteria

- Secrets are not written by default.
- Existing env behavior remains compatible.
- Diagnostics stay redacted.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

## PR 15: Smoke, doctor, docs, and recall debug display

### Problem

As features grow, smoke and diagnostics need to prove real Hindsight compatibility rather than only basic retain/recall/reflect.

### Target behavior

Expand `npm run smoke:hindsight` to test:

- Hindsight reachability
- append capability probe
- project bank creation/ensure
- bank mission upsert if configured/supported
- project recall scope tags
- global recall scope tags when enabled
- explicit retain queue behavior across simulated server recovery if feasible
- reflect still works

Smoke isolation rules:

- Use smoke-specific bank IDs, document IDs, or tags.
- Tag all smoke writes with `source:pi`, `test:smoke`, and a run ID.
- Do not write smoke data into the normal project bank unless the user explicitly configures that bank for smoke.
- Keep smoke retained content harmless and easy to identify.

Add recall debug commands:

```text
/hindsight:recall-last
/hindsight:popup
```

`/hindsight:recall-last` should show the last ephemeral recall block or a redacted summary, depending on `recall.includeFactsInDebug`. `/hindsight:popup` can render the same information in a Pi UI surface if the Pi extension API supports it. Neither command should persist recalled memory into provider-visible transcript history.

Expand `/hindsight:doctor` to report:

- effective config redacted
- selected project/global banks
- append capability
- bank mission support
- observation scope support
- queue length and dead-letter length
- import manifest/checkpoint summary
- current session memory mode once implemented

### Files likely to change

- `scripts/smoke-hindsight.mjs`
- `extensions/diagnostics.ts`
- `extensions/memory-operations.ts`
- `extensions/commands.ts`
- `README.md`
- tests

### Acceptance criteria

- Smoke test catches append/memory-quality integration regressions.
- Smoke writes are isolated from normal project memory.
- Doctor gives clear next actions for common broken states.
- Recall-last/popup display does not persist recalled memory into transcript history.
- Docs match actual config fields and commands.
- `npm run check` passes.
- `npm run typecheck:tsc` passes.

---

# Config evolution summary

This section lists intended config additions across PRs. Each field should be introduced only in its PR, with defaults and normalization tests.

## Retain

```ts
retain: {
  enabled: boolean;
  async: boolean;
  updateMode: "append" | "replace";
  appendFallback: "error" | "per-turn-documents";
  includeToolResults: "meaningful-only" | "all" | "none"; // deprecated alias
  content: {
    user: string[];
    assistant: string[];
    toolResult: string[];
  };
  toolFilter: {
    toolCall: { include?: string[]; exclude?: string[] };
    toolResult: { include?: string[]; exclude?: string[] };
  };
  strip: {
    message: string[];
    topLevel: string[];
  };
  redactSecrets: boolean;
  queuePath: string;
  shutdownFlushMaxJobs: number;
  shutdownFlushTimeoutMs: number;
}
```

## Recall

```ts
recall: {
  enabled: boolean;
  budget: "low" | "mid" | "high";
  maxTokens: number;
  types: string[];
  recentTurnsForQuery: number; // compatibility alias
  contextTurns: number;
  roles: Array<"user" | "assistant" | "tool" | "system">;
  maxQueryChars: number;
  topK: number;
  timeoutMs: number;
  injectionMode: "context";
  injectionPosition: "prepend" | "append";
  includeFactsInDebug: boolean;
}
```

## Banks

```ts
banks: {
  project: {
    enabled: boolean;
    bankId?: string;
    derive: "repo" | "cwd" | "manual";
    mission?: string;
  };
  global: {
    enabled: boolean;
    bankId?: string;
    mission?: string;
  };
}
```

## Observations

```ts
observations: {
  enabled: boolean;
  scopes: string[][];
}
```

## Sessions

```ts
sessions: {
  ignorePatterns: string[];
  readOnlyPatterns: string[];
  skipRecallForReadOnly: boolean;
}
```

## Import

```ts
import: {
  includeBranches: "current-only" | "all-leaves";
  replaceExistingImportedDocs: boolean;
  manifestPath: string;
  checkpointPath: string;
  resume: boolean;
}
```

## Hindsight credentials

```ts
hindsight: {
  baseUrl: string;
  apiKey?: string; // compatibility, redacted, not written by setup by default
  apiKeyRef?: {
    source: "env";
    name: string;
  };
  timeoutMs: number;
}
```

---

# Test plan by area

## Queue and durability

- explicit retain queues when Hindsight is down
- explicit retain flushes later
- explicit retain preserves tags/context/document ID/update mode
- stale lock uses owner timestamp
- fresh active lock is not removed by waiter
- malformed lock owner is treated as stale
- concurrent enqueue/flush does not lose jobs
- dead-letter queue still works after lock changes
- shutdown flush respects configured max jobs and timeout
- status/debug makes bounded shutdown backlog clear

## Capabilities

- append supported
- append unsupported
- append unknown/error state
- fallback `error`
- fallback `per-turn-documents`
- doctor/debug capability output
- capability probe does not pollute normal project recall scope

## Recall

- timeout continues without memory
- query roles respected
- context turns respected
- query max chars respected
- topK passed only through supported adapter path
- project/global tag scopes preserved
- injected recall remains ephemeral

## Bank missions

- project mission normalized
- global mission normalized
- mission passed to bank create/upsert with official field names
- unsupported mission support is diagnostic, not guessed

## Observation scopes

- placeholder expansion
- invalid placeholder rejection
- disabled observations no-op
- duplicate cleanup
- retain request integration only if SDK supports it

## Retain policy

- old `includeToolResults` mapping
- Hindsight tool calls/results excluded
- noisy tool results excluded
- errors retained by default
- configured include/exclude behavior
- strip rules
- sanitizer after projection

## Session governance

- normal/read-only/ignored behavior
- manual tag add/remove
- metadata persistence
- session metadata `.gitignore` policy
- session pattern matching
- precedence rules
- status/debug output

## Import/backfill

- dry-run no writes
- preview deterministic
- resume skips completed docs
- checkpoint `.gitignore` policy
- failed docs remain visible
- current/project session import scope

## Setup and diagnostics

- setup profile writes expected config
- env SecretRef resolves
- safe config redacts secrets
- smoke validates append, bank, recall, retain, reflect
- smoke writes stay isolated from normal memory
- recall-last/popup debug display remains ephemeral

---

# Documentation plan

Update docs incrementally with each PR.

## README updates

For each PR, update:

- Current status feature list
- Configuration section
- Memory behavior section
- Commands/tools section
- Debug and smoke section

## ADR updates

Add ADRs only for lasting architecture decisions:

1. Durable retain queue as shared operation.
2. Append capability fallback policy.
3. Session memory metadata and mode precedence.
4. Observation scopes if API support requires non-obvious mapping.

Do not create ADRs for minor config additions.

## User-facing examples

Add examples for:

- explicit retain during outage
- read-only specialist session
- ignored cron/internal session
- project bank mission
- observation scopes
- import dry-run/preview
- recall-last debug display

---

# Risk register

## Risk: guessing unsupported Hindsight fields

Mitigation:

- Check official Hindsight TypeScript client and docs before coding mission, observation scopes, topK, and capabilities.
- If unsupported, expose diagnostics and defer API wiring.
- Do not invent request shapes.

## Risk: queue locking false positives

Mitigation:

- Base stale decisions only on owner metadata.
- Add direct unit tests.
- Avoid PID liveness unless portable and tested.

## Risk: retaining too much tool output

Mitigation:

- Default to conservative retain policy.
- Exclude Hindsight tools recursively.
- Exclude noisy read/grep/find outputs by default.
- Keep sanitizer after projection.

## Risk: config sprawl

Mitigation:

- Add fields only when needed by a PR.
- Keep defaults simple.
- Document compatibility aliases.
- Keep setup TUI grouped by task, not by raw JSON shape.

## Risk: session metadata pollutes model context

Mitigation:

- Store metadata outside provider-visible messages.
- If using Pi custom entries, confirm they are not sent to the LLM.
- Otherwise use sidecar files.

## Risk: smoke or capability probes pollute real memory

Mitigation:

- Use smoke/probe-specific bank IDs, document IDs, or tags.
- Add deterministic probe document IDs.
- Keep probe content harmless and excluded from normal recall scopes where possible.

## Risk: import accidentally captures unrelated sessions

Mitigation:

- Keep project session discovery repo-scoped.
- Add dry-run first.
- Require explicit command for broad import.

---

# First implementation chunk checklist

Start with PR 1 and PR 2.

## PR 1 checklist

- [ ] Add `extensions/retain-durable.ts`.
- [ ] Add `retainDurably` types and function.
- [ ] Route `retainExplicit` through `retainDurably`.
- [ ] Keep base tags from `explicitRetainTags`.
- [ ] Keep stable explicit document ID.
- [ ] Redact before enqueue.
- [ ] Queue before flush.
- [ ] Return queue/flush status from explicit retain.
- [ ] Add tests for outage and later flush.
- [ ] Update README memory behavior.
- [ ] Run `npm run check`.
- [ ] Run `npm run typecheck:tsc`.

## PR 2 checklist

- [ ] Add queue lock owner type/helper.
- [ ] Read lock owner file during lock conflict.
- [ ] Base stale detection on owner `acquiredAt`.
- [ ] Keep waiter timeout separate.
- [ ] Add lock helper unit tests.
- [ ] Add concurrent enqueue/flush preservation test if not already covered.
- [ ] Add `shutdownFlushMaxJobs` and `shutdownFlushTimeoutMs` config.
- [ ] Route shutdown flush through configured bounds.
- [ ] Update diagnostics/status so remaining queue after bounded shutdown is clear.
- [ ] Run `npm run check`.
- [ ] Run `npm run typecheck:tsc`.

---

# Definition of done for each PR

A PR is done only when:

1. Behavior matches this plan or documented deviation.
2. Tests cover changed memory behavior.
3. README or docs reflect user-visible changes.
4. Diagnostics remain redacted.
5. No raw recalled memory is persisted.
6. No retain path summarizes instead of storing raw structured content.
7. `npm run check` passes.
8. `npm run typecheck:tsc` passes.
9. Live Hindsight smoke test is run if live integration request shape changed and credentials are available.

# Recommended immediate next step

Implement PR 1 first: durable explicit retain.

It is the highest-value small fix because it closes a real memory-loss gap without requiring new Hindsight API discovery. After that, fix queue lock stale detection before adding broader memory-quality features.

---

# Maintainer Feedback Addendum: Global Recall, Budgets, Prompt Cache, and Hindsight-Native Controls

## Source and stance

Feedback from `noctuid/pi-hindsight` is credible implementation input because that extension exercises the same Pi/Hindsight integration surface and already ships several knobs we were planning to add. It should influence defaults and sequencing, but not override this repository's core design goals: durable queue-first retention, official Hindsight client alignment, automatic bank setup, conservative transcript safety, and focused Pi module boundaries.

Local context inspected: `noctuid/pi-hindsight` in `~/.clone-repo-context/agent/sandbox/pi-hindsight`, especially `src/config.ts`, `src/index.ts`, `src/retention.ts`, `src/prepare.ts`, `src/client.ts`, and queue/retention tests.

## Accepted changes

### 1. Make global memory a first-class default option, not an afterthought

The criticism is valid: project-only recall as the practical default prevents cross-project observations from helping. Current code supports a global bank, but the roadmap frames global recall as explicitly non-repo scoped and optional. That is safe, but too passive.

Decision:

- Keep project bank creation as the default because it matches official integration expectations and avoids one giant accidental memory bank.
- Add setup profiles that make global memory easy and recommended:
  - `project-only`: safest default for sensitive repos.
  - `project+global`: recommended balanced default for most users.
  - `global-only`: useful for personal assistants, scripts, and repo-agnostic workflows.
- In `project+global`, recall should query both project and global banks, with clear labels in injected context.
- Retain should keep project-scoped conversation content in the project bank by default. Global retention should be explicit through routing/profile configuration, not silently duplicate every repo transcript into global memory.
- Observation consolidation should be able to use global scopes where configured.

Roadmap impact:

- Pull global-bank UX forward from PR 13 into the next configuration/defaults PR.
- Add docs explaining privacy tradeoffs and when global recall should be enabled.

### 2. Change default recall budget from `low` to `mid`

The current `low` default was chosen from caution, not measured evidence. The maintainer reports `mid` is fast and practical. Their extension defaults `autoRecallBudget` to `mid`. Hindsight recall is expected to be milliseconds-scale, unlike reflect.

Decision:

- Change `DEFAULT_CONFIG.recall.budget` from `low` to `mid`.
- Keep `maxTokens`, `topK`, `timeoutMs`, and query truncation conservative.
- Keep setup/config support for `low` for users who want minimum latency.

Roadmap impact:

- Add to the next defaults PR before more recall-query work, because it is user-visible behavior and affects docs/tests.

### 3. Stop prepending by default; protect prompt caching

This is the strongest actionable criticism. Prepending fresh recall before existing context changes the early prompt prefix every turn and can damage provider prompt caching. The previous default `recall.injectionPosition = "prepend"` should change to `append`.

Decision:

- Change default recall injection position to `append`.
- Prefer appending as a system context block at the end of existing context, before the new user turn if Pi serialization allows that safely.
- Keep explicit position configurability only if tests prove both modes serialize safely and docs warn that prepend hurts caching.
- If possible in Pi hooks, remove or de-emphasize `prepend` from setup UI.

Roadmap impact:

- Add a prompt-cache safety PR before deeper recall-query changes.
- Tests must assert appended recall does not become final user content and does not get retained.

### 4. Make observation scopes customizable on retain, without inventing unsupported fields

The feedback is directionally right. `noctuid/pi-hindsight` stores `observationScopes`/`observation_scopes` in queue entries and passes them through retention paths. This repository currently expands scopes for config/diagnostics and maps `observations.enabled` to bank settings, but avoids adding unsupported request fields. That caution remains correct until official client/API support is confirmed.

Decision:

- Add a client capability/adaptor layer for retain observation scopes only after verifying official Hindsight API/client support.
- If supported, capture expanded observation scopes at queue time so queued jobs preserve the context active when the message was retained.
- Support placeholder expansion for at least `{cwd}`, `{repo}`, `{session}`, `{branch}`, `{bank}`, and user-defined literals.
- Scope policy belongs in config and retained job payloads, not metadata filtering.

Roadmap impact:

- Replace the vague current PR 9 "session pattern rules" with a concrete memory-quality PR: customizable observation scopes on retain plus placeholder tests, gated by capability detection.

### 5. Keep and extend rich retain projection controls

This is already partially done in PR 7. The other extension confirms this matters: thinking inclusion, specific tool-call/result filtering, and field stripping all need config. Our current design now has `retain.content`, `retain.toolFilter`, and `retain.strip`, which is aligned.

Decision:

- Keep current controls.
- Add follow-up tests for thinking inclusion/exclusion and named tool-call/result removal if not already covered enough.
- Do not broaden this into a generic message-rewrite engine.

### 6. Keep PR 8 session tags and retain on/off; add session start timestamp later

PR 8 now covers per-session tags and retain mode. The maintainer also noted timestamp should be session start time. That is valid for stable chronological retention and Hindsight ordering.

Decision:

- Keep PR 8 as-is if review is clean.
- Add a later focused PR to persist session start timestamp and use it consistently for session-level retain/import metadata where Hindsight expects timestamps.

### 7. Consider per-session queue files, but do not switch immediately

The other extension queues on `message_end` into per-session queue files, avoiding dedup and improving crash resistance. This is a strong design point, but switching now would be a larger architectural migration. Our current queue has been hardened with locks, durable explicit retain, and cursoring.

Decision:

- Do not replace queue architecture in the current PR sequence.
- Add a design spike/PR after import workflow work to evaluate message-end queueing and per-session queue shards.
- If adopted, migrate incrementally: keep current queue reader compatible, write new per-session queue files for new auto-retain jobs, and provide a queue migration/flush path.

### 8. Recall query construction needs its own improvement PR

Both implementations likely under-optimize recall query construction. Current roadmap has controls but not better query synthesis.

Decision:

- Add a dedicated recall-query PR after prompt-cache/default fixes.
- Improve query formation using recent user intent, bounded assistant context, session title/path/branch, and optional preamble/date injection.
- Do not use reflect for automatic recall query generation.
- Keep query construction deterministic and testable.

### 9. Optional recall visibility is useful, but must remain non-provider-visible

The maintainer supports opt-in persisted recall display. This repo currently defers persisted recall messages because recalled blocks must not be persisted into transcript history or retained back into memory. Visibility is still valuable for debugging.

Decision:

- Keep automatic recall ephemeral by default.
- Add an opt-in recall debug/display feature that stores last recall in a sidecar/debug panel or custom hidden message filtered from provider context and retention.
- Do not persist recall into normal conversation history unless Pi guarantees it can be excluded from provider serialization and retain.

## Rejected or deferred changes

- Do not make a single global bank the only default. It is useful, but unsafe for unrelated repos and sensitive work.
- Do not pass undocumented `observation_scopes` fields through the official client until API support is verified.
- Do not remove project bank support. Automatic bank creation and project bank derivation remain a differentiator and align with official integration expectations.
- Do not immediately migrate to environment-variable-only configuration. Env vars are useful for scripts, but project config is easier to inspect, commit intentionally, and support through setup UI. Add env overrides where they improve automation.

## Revised near-term PR order

1. PR 8: Session memory metadata, modes, and tags. Keep current PR focused; do not mix default changes into it unless Codex requests related fixes.
2. PR 9: Recall defaults and prompt-cache safety.
   - default budget `mid`
   - default injection position `append`
   - docs/tests for prompt-cache rationale
   - setup UI updated to discourage prepend
3. PR 10: Global memory profiles and setup defaults.
   - `project-only`, `project+global`, `global-only`
   - clear privacy docs
   - diagnostics show active recall/retain routes
4. PR 11: Customizable retain observation scopes with capability guard.
   - queue-time placeholder expansion
   - supported API/client path only
   - no undocumented retain fields without proof
5. PR 12: Recall query construction improvements.
   - deterministic query builder
   - optional preamble/date injection
   - tests for truncation and role handling
6. PR 13: Optional recall visibility/debug display.
   - sidecar or custom filtered message
   - never retained and never provider-visible by default
7. PR 14+: Resume existing import dry-run, checkpointing, setup profiles, SecretRef, smoke/doctor work.

---

# Maintainer Feedback Addendum 2: RetainBatch, Bank Strategy, Recall Visibility Tradeoffs, and Query V2

## Source and stance

Follow-up feedback from `noctuid/pi-hindsight` adds useful implementation details and product tradeoffs. These comments mostly reinforce the current direction: keep safe official-integration defaults, but support power-user/global-bank workflows through explicit profiles and knobs.

## Accepted additions

### 1. Track upstream gap: `retain()` lacks observation scopes, `retainBatch()` supports them

The official Hindsight TypeScript client currently exposes `observation_scopes` on batch retain item input, but not on the single-memory `retain()` helper. This is likely an API/client ergonomics gap.

Current repo status:

- PR 12 already uses the safe path: internal `observationScopes` are mapped to official `retainBatch()` `observation_scopes` only when scopes are present.
- Integration tests assert the wire payload uses snake_case `observation_scopes` and does not leak camelCase fields.
- No unsupported `retain()` request field is invented.

Decision:

- Open an upstream Hindsight issue requesting `retain()` support for observation scopes or documenting that `retainBatch()` is the canonical path.
- Consider a small adapter-cleanup PR later to use `retainBatch()` for all retain writes, even single-item writes, if this simplifies behavior and stays compatible.
- Do not block current work on upstream API changes.

Roadmap impact:

- Add a follow-up PR after current memory-quality work: “standardize retain transport on retainBatch or document mixed retain/retainBatch adapter behavior.”

### 2. Support one-bank workflows with tags/scopes, but keep project banks as safe default

The feedback is correct that many isolation needs can be solved inside one bank with strict tags and observation scopes. Multiple banks are not the only valid model.

Decision:

- Keep project banks as the safest default because they provide a clear privacy boundary, easier per-repo deletion/export/debugging, and project-specific bank missions.
- Keep `project+global` as the recommended balanced profile for personal coding workflows.
- Keep `global-only` as the explicit one-bank/power-user workflow for users who prefer tags and observation scopes over per-project bank creation.
- Improve docs to explain when to choose each model:
  - `project-only`: sensitive repos and strong separation.
  - `project+global`: most personal coding use; project facts plus durable global preferences.
  - `global-only`: users who intentionally isolate with tags/scopes inside one shared bank.

Roadmap impact:

- Add docs/tests refinement later for profile guidance and visibility of active recall/retain routes.
- Do not remove project bank derivation or automatic bank creation.

### 3. Transcript-persisted recall visibility remains opt-in only and needs cleanup tooling

Persisting recalls into normal conversation history has one benefit: if a user later removes or disables the extension, old recalls remain visible in session history. The tradeoff is high: persisted recall blocks may leak into provider context, be retained back into Hindsight, or require the extension to stay installed solely to filter them out.

Current repo status:

- PR 14 adds sidecar recall visibility instead of transcript persistence.
- Default remains off.
- Sidecar snapshots are not provider-visible and not auto-retained.

Decision:

- Keep sidecar/debug recall visibility as the default visibility model.
- Do not persist recall blocks into normal Pi transcript history by default.
- If transcript-persisted recall visibility is ever added, it must be:
  - explicitly opt-in
  - clearly labeled as provider/retain contamination risk
  - filterable from provider serialization and automatic retain
  - paired with a confirmable cleanup command before release

Potential cleanup command:

- `/hindsight:recall-history scan`
  - dry-run count of persisted synthetic recall messages in current session or selected sessions
- `/hindsight:recall-history prune`
  - confirmable removal of synthetic recall messages from session JSONL files
  - default current session only
  - alternate branch/session cleanup explicit

Roadmap impact:

- Add transcript recall visibility only as a later optional feature after Pi serialization/filtering behavior is proven.
- If not proven safe, keep sidecar-only indefinitely.

### 4. Recall query construction V2: bank-aware deterministic query shaping

The current recall query work in PR 13 is already useful and worth sharing with the other maintainer:

- deterministic query builder
- role-labeled message lines
- configurable `recall.queryPreamble`
- optional `recall.includeDateInQuery`
- role/context/max-character bounds
- injected-memory filtering
- empty-turn fallback after Codex feedback
- no reflect/LLM dependency in automatic recall path

Next improvement should preserve determinism while making queries bank-aware.

Decision:

- Add a Recall Query V2 PR after PR 14 / recall visibility work.
- Shape project-bank and global-bank queries differently:
  - project bank: current task, repo identity, branch, cwd/module hints, recent relevant user/assistant context
  - global bank: durable user preferences, recurring workflows, style, coding habits, cross-project decisions
- Consider config:
  - `recall.projectQueryPreamble`
  - `recall.globalQueryPreamble`
  - optional inclusion of repo/branch/cwd metadata in query
- Keep bounded and deterministic:
  - no automatic `reflect` query generation
  - no unbounded transcript dump
  - no same-turn retain dependency
  - tests for truncation, role filtering, bank-specific preambles, metadata inclusion, and global/project behavior

Roadmap impact:

- Insert Recall Query V2 before larger import/setup polish if current PR sequence allows.
- Update maintainer notes after implemented so `noctuid` can compare approaches.

## Updated implementation status

Completed in follow-up PRs:

1. Opt-in recall visibility sidecar.
2. Recall Query V2 with bank-aware deterministic query shaping.
3. Retain transport cleanup: adapter now uses `retainBatch()` for retain writes.
4. Profile documentation refinement for `project-only`, `project+global`, and `global-only`.
5. Queue durability, append fallback replay, recall failure hardening, observation-scope retain alignment, and unreleased legacy cleanup after retrospective review of early PRs.
6. Import UX improvements:
   - dry-run previews
   - all-leaves override
   - checkpoint/resume
   - project-scoped session import commands
7. Setup deployment guidance and API key SecretRef support.
8. Doctor/smoke diagnostics polish.

Completed later:

9. Recall cleanup command for scanning/pruning accidentally persisted `<hindsight-memory>` transcript blocks.
10. Upstream Hindsight issue for single `retain()` observation-scope support: https://github.com/vectorize-io/hindsight/issues/1290
11. Release verification documentation polish.

Remaining candidates:

1. Optional transcript-persisted recall visibility only if Pi serialization/retain filtering is proven safe. Keep sidecar-only default indefinitely unless this is proven.
2. Release execution: changelog/version prep and live configured-server smoke run when credentials are available.
