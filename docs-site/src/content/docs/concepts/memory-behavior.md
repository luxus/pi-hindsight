---
title: "Memory behavior"
---

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

`recall.queryTimestamp` should normally be omitted. Set it only when recall should be anchored to a specific point in time.

## Last-recall snapshots

Set `recall.storeLastRecall: true` to write a local visibility snapshot for `/hindsight:last-recall`. Add `recall.storeLastRecallFailures: true` to include failed recall attempts when all recalls fail.

Snapshots can contain recalled memory and query excerpts. Enable them only when local disk visibility is acceptable. Snapshots are not inserted into provider context or automatic retain.

Use:

```text
/hindsight:last-recall
/hindsight:last-recall --json
```

`/hindsight:recall-cleanup` scans the current Pi session transcript for accidentally persisted `<hindsight-memory>` blocks. Pruning requires an explicit offline file path:

```text
/hindsight:recall-cleanup <session.jsonl> --prune
```

A unique backup is written next to the session file before pruning.

## Retain

Automatic retain runs in Pi's `agent_end` hook. It stores a structured JSON projection of new messages, not a summary.

Live sessions use stable `documentId` values and `updateMode: "append"`. A persisted retain cursor under `.pi/hindsight/retain-cursors.json` prevents duplicate appends when Pi provides overlapping transcripts, including after extension restart.

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

Flush routes:

```text
/hindsight:flush
```

Retain also flushes on new retain attempts and shutdown. Set `retain.flushIntervalMs` to a positive interval to flush periodically while Pi is running. Periodic background flushes are bounded separately by `retain.periodicFlushMaxJobs` and `retain.periodicFlushTimeoutMs`.

Shutdown flushing is bounded by `retain.shutdownFlushMaxJobs` and `retain.shutdownFlushTimeoutMs`. If jobs remain after shutdown, they stay on disk and are visible through `/hindsight`.

## Banks and missions

Project and global bank missions live in Hindsight's bank configuration/database, not as normal Pi JSON settings. Pi's local JSON should identify which banks to use; Hindsight owns the extraction, reflection, and observation instructions for those banks.

Pi still understands legacy local mission fields (`retainMission`, `reflectMission`, and `observationsMission`) so existing configs do not break. Treat them as migration/fallback inputs. New mission edits should go through Hindsight bank configuration/profile APIs and the Hindsight web interface.

Project banks focus on repo architecture, decisions, constraints, bugs, fixes, TODOs, conventions, and project-local preferences. Global banks focus on durable user preferences, recurring workflows, coding habits, and stable assistant behavior while excluding repo-specific code facts by default.

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
/hindsight:mode normal
/hindsight:mode read-only
/hindsight:mode ignored
/hindsight:retain on
/hindsight:retain off
/hindsight:next-opt-out
/hindsight:tag add <tag>
/hindsight:tag remove <tag>
```

`read-only` recalls but does not automatically retain. `ignored` disables recall and retain. `next-opt-out` skips automatic retain for the next completed run only. ADR 003 defines the TUI vocabulary and mode matrix for `normal`, `read-only`, `ignored`, and reserved future `tools-only`.

## Global memory policy

`globalRetain.mode` defaults to `explicit-only`. That means automatic project transcript retain does not write global memory unless the user explicitly opts into router mode.

`hindsight_retain_global` is the preferred tool for durable global user identity, preferences, and cross-project workflows.

`hindsight_route_memory` is a dry-run classifier for `project`, `global`, `both`, or `skip`. In `explicit-only` mode, routing suggestions do not write global memory automatically. ADR 002 documents the explicit routing strategy seam and safety policy for future richer bank topologies.
