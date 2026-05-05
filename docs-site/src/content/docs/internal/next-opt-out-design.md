---
title: "One-turn memory opt-out design"
---

This document defines the preferred one-turn memory control for Pi Hindsight. It intentionally avoids prompt hashtag parsing such as `#nomem`.

## Problem

Users sometimes need a fast way to keep the next agent run out of automatic memory retention without changing the whole session mode.

Examples:

- The next prompt contains throwaway sensitive material.
- The next run is exploratory noise that should not become project memory.
- The user wants a quick one-shot control discoverable through Pi command autocomplete.

## Decision

Implemented in PR #55.

Use an explicit command:

```text
/hindsight:next-opt-out
```

Do not parse prompt hashtags.

## Why command-based control

Pi command autocomplete makes the command discoverable by typing `next`, `opt`, or `out`.

A command is better than prompt parsing because it is:

- explicit in command history
- independent of Markdown syntax
- testable without parsing arbitrary prose
- less likely to be copied by agents into generated content
- easier to reason about during import and cursor handling

## Current semantics

`/hindsight:next-opt-out` applies once to the next completed agent run in the current session.

It disables automatic retain for that run only.

It does not disable recall. The user may still want memory context to answer the prompt, while not retaining the new prompt/result.

It does not affect explicit memory tools. If an agent or user explicitly calls `hindsight_retain`, that explicit retain remains intentional and should still work.

It does not affect historical import. Import reads the transcript as source material and is governed by import commands, not transient one-turn state.

It stores state outside provider-visible messages, alongside existing session memory metadata.

After the next completed agent run is skipped, the opt-out flag is consumed and cleared.

## Interactions

### `/hindsight:mode ignored`

Ignored mode already disables recall and retain for the session. `next-opt-out` is redundant while ignored mode is active.

### `/hindsight:mode read-only`

Read-only mode already disables retain while allowing recall. `next-opt-out` is redundant while read-only mode is active.

### `/hindsight:retain off`

Retain off already disables automatic retain for the session. `next-opt-out` is redundant while retain is off.

### Retain cursor

When `next-opt-out` skips a run, the retain cursor should mark the skipped projected messages as handled. Otherwise those messages could be retained on a later overlapping `agent_end` event after the one-turn opt-out expires.

This matches current read-only and ignored mode behavior.

### Recall

Recall remains enabled unless another session mode disables it. This keeps the command narrow and avoids surprising users who only wanted to prevent storage.

A future command could add recall control explicitly, but it should not be overloaded into this first command.

## User-facing behavior

Command:

```text
/hindsight:next-opt-out
```

Success message:

```text
Hindsight will skip automatic retain for the next agent run in this session. nextRetain=off
```

Session status should show pending one-turn opt-out:

```text
Hindsight session mode=normal; recall=true; retain=true; nextRetain=off; tags=none
```

When consumed, the activity notification says:

```text
Hindsight skipped retain for this run due to next-opt-out.
```

## Storage shape

Extend session memory metadata with a non-provider-visible field:

```json
{
  "nextRetainMode": "off"
}
```

The default is `"normal"`.

Clearing the one-turn opt-out normalizes the field back to `"normal"`.

## Implemented tests

Tests assert external behavior, not internal helper details.

Covered:

- session metadata persists and consumes a one-turn retain opt-out
- next `agent_end` skips automatic retain
- skipped messages are added to retain cursor so they are not retained later
- opt-out clears after one completed agent run

Additional coverage added after implementation:

- command handler sets a pending one-turn retain opt-out
- `/hindsight:session` reports pending opt-out
- explicit `hindsight_retain` still queues normally while next opt-out is pending
- historical import ignores next opt-out state

Additional coverage added after fail-closed hardening:

- recall still runs while next retain is off
- ignored/read-only/retain-off modes remain stronger than next opt-out
- next opt-out remains pending if retain cursor marking fails

## Out of scope

- `#nomem` or any prompt hashtag parsing
- routing control through prompt text
- disabling explicit retain tool calls
- changing historical import behavior
- provider recall cache
- persisted recall transcript messages

## Future options

Possible future commands, only if real use justifies them:

```text
/hindsight:next-recall off
/hindsight:next-mode ignored
/hindsight:next-retain off
```

Do not add aliases until the core command proves useful.
