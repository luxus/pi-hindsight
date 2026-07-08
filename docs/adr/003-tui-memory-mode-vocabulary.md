# ADR 003: TUI memory mode vocabulary

## Status

Accepted and implemented for `normal`, `read-only`, and `ignored`. Reviewed 2026-05-09; still relevant.

`tools-only` remains reserved vocabulary and must not appear as an enabled mode until behavior is implemented.

## Context

Pi Hindsight has separate controls for recall, automatic retain, explicit tools, imports, flush, and one-turn opt-out. Those controls are correct but too implementation-shaped for the `/hindsight` TUI. Users need a small vocabulary that explains what memory will do without changing the underlying safe defaults.

The design should not add provider recall caching, prompt hashtag controls, automatic reflect prefetch, or new routing behavior.

## Decision

The TUI (and historically `/hindsight:mode`) describe session memory behavior with three implemented user-facing modes and one reserved future mode:

1. `normal`
2. `read-only`
3. `ignored`
4. future `tools-only`

`normal` is the default mode. `read-only` and `ignored` map to existing session behavior. `tools-only` is reserved vocabulary for a future slice and must not appear as an enabled option until implemented.

These names are TUI vocabulary, not a replacement for the lower-level config model. Existing config keys remain source of truth for recall, retain, import, and routing behavior.

## Mode matrix

| Mode                | Automatic recall | Automatic retain | Explicit tools and commands                                       | Import  | Flush queued jobs | Intended use                                             |
| ------------------- | ---------------- | ---------------- | ----------------------------------------------------------------- | ------- | ----------------- | -------------------------------------------------------- |
| `normal`            | on if configured | on if configured | allowed                                                           | allowed | allowed           | Default coding with project memory continuity.           |
| `read-only`         | on if configured | off              | read tools allowed; explicit retain is blocked until mode changes | allowed | allowed           | Use existing memory without adding new transcript facts. |
| `ignored`           | off              | off              | explicit operations remain available from commands/tools          | allowed | allowed           | Work without automatic memory participation.             |
| future `tools-only` | off              | off              | allowed                                                           | allowed | allowed           | No automatic memory; user manually calls tools.          |

## Semantics

### `normal`

`normal` means Pi Hindsight follows configured automatic behavior:

- recall injects ephemeral memory before answer generation when enabled
- retain queues sanitized transcript deltas at agent end when enabled
- User Bank automatic retain stays governed by `userRetain.mode` and profile choices; `globalRetain.mode` remains only a legacy alias
- explicit tools and TUI actions are available
- imports and queue flushes are available

### `read-only`

`read-only` means automatic writes are disabled while reads stay available:

- automatic recall can still run
- automatic retain does not enqueue new transcript deltas
- explicit retain is blocked until the session returns to `normal`; other deliberate write operations such as imports keep their own confirmations
- imports remain deliberate operations, not automatic session retention
- queue flush remains allowed because it drains already accepted jobs

### `ignored`

`ignored` means automatic memory is out of the provider path:

- no automatic recall injection
- no automatic retain
- explicit commands and tools still exist for power users
- imports and queue maintenance are not disabled by the mode
- status should make the automatic-memory-off state obvious

### future `tools-only`

`tools-only` is a reserved term for a future mode where automatic memory is off but explicit tools are first-class. It should only ship after the command/tool behavior is tested and documented as distinct from `ignored`.

## TUI presentation

The `/hindsight` TUI should prefer these labels when explaining session memory state:

- `normal`: "Automatic recall/retain follow config."
- `read-only`: "Recall can read; automatic retain is off."
- `ignored`: "Automatic recall and retain are off."
- future `tools-only`: "Automatic memory is off; explicit tools stay available."

The TUI should still expose underlying facts where useful, such as recall enabled/disabled, retain enabled/disabled, User Bank retain mode, queue state, and bank status.

## Non-goals

- Do not change defaults.
- Do not add prompt hashtag controls.
- Do not add provider recall caching.
- Do not prefetch reflect results automatically.
- Do not collapse import or explicit retain semantics into automatic retain.
- Do not make User Bank automatic retain default.

## Follow-up implementation status

Completed:

1. Add a presenter that derives the TUI mode label from resolved config plus session metadata.
2. Add status facts for the mode matrix row currently in effect.
3. Add TUI copy for `normal`, `read-only`, and `ignored`.

Still future:

1. Keep `tools-only` documented as reserved until behavior is implemented.

## Consequences

This gives the TUI a stable mental model without changing memory behavior. It also keeps safety boundaries explicit: automatic read/write behavior is separate from deliberate user operations such as imports, explicit retain, and queue flushing.
