# Memory behavior

This document describes the runtime memory path: recall, retain, queues, scopes, and safety behavior.

## Recall

Automatic recall runs in Pi's `context` hook. The extension composes a deterministic query from recent transcript context, asks Hindsight for relevant memory, and injects an ephemeral `<hindsight-memory>` block into provider context.

The injected block is not written to the Pi transcript by this extension and is not retained back into Hindsight.

Defaults:

- `recall.types: ["observation"]`
- `recall.budget: "mid"`
- `recall.injectionPosition: "append"`
- project recall is scoped by the current repo tag
- global recall uses explicit non-repo `source:pi` scope

Set `recall.types` to include `world` or `experience`, or to an empty list, only when you explicitly want lower-level memory types.

Each recall scope is enforced with a strict Hindsight `tag_groups` filter (`any_strict`), so project and user memory stay isolated. The `hindsight_recall` and `hindsight_reflect` tools accept an optional `tagGroups` filter that is AND-ed with the automatic scope.

Set `recall.includeSourceFacts: true` (bounded by `recall.maxSourceFactsTokens`) to attach supporting evidence lines to recalled observations. It is off by default to keep recall conservative.

`recall.queryTimestamp` should normally be omitted. Set it only when recall should be anchored to a specific point in time.

## Recall quality

After Hindsight returns candidates for **automatic** recall, Pi applies a local quality pass before rendering the ephemeral context block. This pass does not change what Hindsight stored; it only decides what gets injected this turn.

### Always-on shape filters

These run for every automatic recall, with no config required:

- **blank-memory** — empty or whitespace-only text
- **duplicate-memory** — same normalized text already kept in this response
- **recall-contamination** — payload that looks like a previously injected memory or mental-model block (or related sidecar markers)

### Optional score floors (`recall.minScores`)

You can also drop candidates whose returned per-stage scores fall below configured floors. Supported fields: `semantic`, `reranker`, `final`, `keyword`.

```json
"recall": {
  "minScores": {
    "reranker": 0.2
  }
}
```

Env overrides for the common pair:

- `PI_HINDSIGHT_MIN_RERANKER`
- `PI_HINDSIGHT_MIN_SEMANTIC`

**Defaults are off.** Score scales depend on embedding model, reranker, budget, bank size, and server version. A floor that separates junk from useful memory on one deploy can over- or under-filter on another. Prefer measuring on your server (see [Last-recall snapshots](#last-recall-snapshots)) before enabling floors.

### Fail-open rules

When floors are set:

| Situation                                       | Result                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Score field is a number **below** its floor     | Drop (`below-score-floor`)                                 |
| No `scores` object on the result                | **Keep** (BM25-only or older payloads)                     |
| Floor set for a field that is missing or `null` | **Keep** that field (do not treat as below floor)          |
| Multiple floors set                             | **AND** — any present field below its floor drops the item |

### Local auto-recall vs tool `minScores`

- Automatic recall floors are a **local** filter after Hindsight returns results.
- The `hindsight_recall` tool's optional `minScores` argument is a **passthrough to the Hindsight API** on explicit tool calls. The two knobs are independent.

### Suggested starting point

If auto-inject looks noisy and low-rerank junk is obvious, try a soft reranker-only floor first:

```bash
export PI_HINDSIGHT_MIN_RERANKER=0.2
```

Exact field names and env wiring: [Configuration](configuration.md).

## Last-recall snapshots

Set `recall.storeLastRecall: true` to write a local visibility snapshot under `.pi/hindsight/` for debugging. Add `recall.storeLastRecallFailures: true` to include failed recall attempts when all recalls fail.

Snapshots can contain recalled memory and query excerpts. Enable them only when local disk visibility is acceptable. Snapshots are not inserted into provider context or automatic retain.

Inspect snapshots on disk under the configured `recall.lastRecallPath` (default `.pi/hindsight/last-recall.json`). There is no public slash command for last-recall; the snapshot is a debug sidecar only.

Recall-block cleanup for accidentally persisted `<hindsight-memory>` lines remains available as a recovery path through shared memory operations; prefer keeping recall ephemeral so cleanup is not needed.

## Retain

Automatic retain runs in Pi's `agent_end` hook. It stores a structured JSON projection of new messages, not a summary.

Live sessions use stable `documentId` values and `updateMode: "append"`. A versioned retain cursor under `.pi/hindsight/retain-cursors.json` tracks the last retained transcript index plus hash chains and a bounded tail window (200 messages) so overlapping `agent_end` transcripts dedupe for append-only sessions, including after extension restart. Legacy fingerprint-only cursor files migrate on read without a duplicate-retain burst.

The retain projection is controlled by:

- `retain.content`
- `retain.toolFilter`
- `retain.strip`

Defaults keep user/assistant text, assistant tool calls, tool result errors, and per-message timestamps while excluding recursive Hindsight tool output and noisy read/search results.

Explicit retain tool tags are merged with base `source:pi`, repo, and session tags so manually retained memories remain visible to default project recall.

## Queue-first durability

Retain jobs are written to a JSONL queue before sending. If Hindsight is down, jobs remain on disk for later flushing. This queue-first behavior applies to automatic retain and the explicit `hindsight_retain` tool.

Queue behavior:

- in-process mutex plus lock directory next to the queue file
- stale locks judged from the lock owner's `acquiredAt` timestamp
- malformed active lines quarantined to a malformed sibling file
- exhausted jobs moved to `<queue>.dead.jsonl`
- diagnostics summarize queue state without printing raw retained content

Flush routes: open `/hindsight` and press `f`. Retain also flushes on new retain attempts and shutdown. Set `retain.flushIntervalMs` to a positive interval to flush periodically while Pi is running. Periodic background flushes are bounded separately by `retain.periodicFlushMaxJobs` and `retain.periodicFlushTimeoutMs`.

Shutdown flushing is bounded by `retain.shutdownFlushMaxJobs` and `retain.shutdownFlushTimeoutMs`. If jobs remain after shutdown, they stay on disk and are visible through `/hindsight`.

When Hindsight 0.8+ returns retain outcome metadata, flush reporting, `/hindsight:queue`, and the `/hindsight` status tab surface lightweight aggregates (items extracted, async operations, token usage), and the latest per-document outcome is kept in `retain-receipts.json`. Only aggregates are persisted — never raw retained payloads. Older servers that omit this metadata degrade gracefully with no outcome shown.

## Banks and missions

Project and global bank missions live in Hindsight's bank configuration/database, not as normal Pi JSON settings. Pi's local JSON should identify which banks to use; Hindsight owns the extraction, reflection, and observation instructions for those banks.

Pi still understands legacy local mission fields (`retainMission`, `reflectMission`, and `observationsMission`) so existing configs do not break. Treat them as migration/fallback inputs. New mission edits should go through Hindsight bank configuration/profile APIs and the Hindsight web interface.

Project banks focus on repo architecture, decisions, constraints, bugs, fixes, TODOs, conventions, and project-local preferences. Global banks focus on durable user preferences, recurring workflows, coding habits, and stable assistant behavior while excluding repo-specific code facts by default.

`banks.project.retainStructuredChunkSize` and `banks.user.retainStructuredChunkSize` (Hindsight 0.8.x) tune how large a structured JSONL conversation turn can grow before Hindsight splits it into a new chunk during retain. Like the mission fields above, this is a raw-JSON-only bank config field with no TUI wiring; it only takes effect the first time pi-hindsight creates the bank, not on existing banks.

## Observation scopes

Observation scope configuration lives under `observations`. The extension validates and expands scope placeholders for diagnostics, passes `observations.enabled` to bank ensure as Hindsight `enableObservations`, and stores expanded scopes on queued retain jobs so retries preserve the policy active when the job was created.

Supported placeholders:

- `{repoKey}`
- `{sessionId}`
- `{cwdHash}`
- `{projectBankId}`
- `{bankId}`

`{bankId}` is an alias for the target bank ID and is clearer for explicit retain/import paths that write to a custom or global bank.

## Session controls

Per-session governance is stored outside provider-visible messages under `.pi/hindsight/session-meta/`.

```text
/hindsight                 # hub: m = mode, x = next-opt-out
/hindsight:next-opt-out    # skip automatic retain for the next agent run only
```

Session mode is set from the `/hindsight` hub (`m`): `normal`, `read-only`, or `ignored`.  
`read-only` recalls but does not automatically retain. `ignored` disables recall and retain.  
`next-opt-out` (slash command or hub `x`) skips automatic retain for the next completed run only.  
ADR 003 defines the TUI vocabulary and mode matrix for `normal`, `read-only`, `ignored`, and reserved future `tools-only`.

## Global memory policy

`globalRetain.mode` is always `explicit-only`. Automatic project transcript retain never writes User Bank (global) memory in any profile.

`hindsight_retain_global` is the preferred tool for durable global user identity, preferences, and cross-project workflows.

ADR 004 removed the heuristic memory router that used to classify retain candidates as `project`, `global`, `both`, or `skip`; ADR 002 documents the explicit routing strategy seam it superseded.
