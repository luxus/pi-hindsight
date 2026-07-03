# Tools and commands

For a generated reference of registered tools, commands, and editable config fields, see [`surface-reference.md`](surface-reference.md).

`/hindsight` is the main control center. Commands are convenience shortcuts and escape hatches for advanced workflows.

## Main command

```text
/hindsight
```

Shows memory status, selected banks, config facts, retain queue status, import status, and recent retain receipts. Status activity can distinguish recall, retain, and import work, including `importing`, `imported`, `import-queued`, and `import-failed`. It also exposes setup/config editing actions. Press `f` to flush queued retain jobs from the TUI. Mental models and directives are managed in the Hindsight control-plane web UI.

## Setup and config

```text
/hindsight:init
```

Writes `.pi/hindsight.json` with the current project bank ID and Hindsight base URL. Use `/hindsight` for interactive setup.

## Import

```text
/hindsight:import-current --dry-run
/hindsight:import-current
/hindsight:import-file /path/to/session.jsonl --dry-run --all-leaves
/hindsight:import-project-sessions --dry-run
/hindsight:import-project-sessions
```

Use dry-run before non-dry-run imports. See [`import-controls.md`](import-controls.md) and [`importing-sessions.md`](importing-sessions.md).

## Queue and snapshots

```text
/hindsight:queue
/hindsight:queue --jobs --json
/hindsight:flush
/hindsight:last-recall
/hindsight:last-recall --json
/hindsight:recall-cleanup
/hindsight:recall-cleanup <session.jsonl> --prune
```

`/hindsight:queue` summarizes active and dead-letter retain queues without printing retained payloads. Add `--jobs --json` for redacted job metadata such as job id, bank id, document id, tags, byte counts, retry count, and last error. `/hindsight:flush` flushes queued retain jobs. `/hindsight:last-recall` reads the opt-in local recall snapshot. Recall cleanup reports or prunes accidentally persisted `<hindsight-memory>` transcript lines.

## Session controls

```text
/hindsight:session
/hindsight:mode normal
/hindsight:mode read-only
/hindsight:mode ignored
/hindsight:retain on
/hindsight:retain off
/hindsight:next-opt-out
/hindsight:tag add <tag>
/hindsight:tag remove <tag>
```

- `read-only`: recall still works; automatic retain is skipped.
- `ignored`: recall and retain are skipped.
- `retain off`: disables automatic retain for the session.
- `next-opt-out`: skips automatic retain once, then clears itself.
- manual tags are merged into automatic retain jobs.

## Explicit tools

Pi exposes exactly four memory tools:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_retain_global`
- `hindsight_reflect`

Everything else — bank config/profile administration, document/entity/graph/tag browsing, memory inspection, consolidation control, and operation management — lives in the Hindsight control-plane web UI.

Tool notes:

- In Pi's interactive TUI, memory tool outputs share one normalized text renderer and support the normal tool-output expansion toggle (`Ctrl+O` by default). Short outputs render in the same model without needing to fold; long outputs render as compact previews until expanded.
- `hindsight_recall` accepts `queryTimestamp` plus advanced one-off controls: `types`, `budget`, `maxTokens` (including `0`), `includeChunks`, `recallChunksMaxTokens`, `includeSourceFacts`, `maxSourceFactsTokens`, `includeEntities`, and `trace`.
- `hindsight_retain` and `hindsight_retain_global` accept explicit Hindsight retain options: `entities`, `documentId`, `timestamp` (including literal `unset`), `metadata`, `updateMode`, `observationScopes`, `documentTags`, and `async`. `observationScopes` accepts `per_tag`, `combined`, `all_combinations`, `shared`, or explicit string groups. Hindsight supports `documentTags` for compatibility, but upstream marks it deprecated; prefer normal `tags` unless document-level interop requires it.
- For `updateMode: "append"`, use a stable `documentId` when continuing a known document. If omitted, pi-hindsight still uses its deterministic explicit-retain document ID; repeated calls only append together when content/context/session produce the same ID.
- Caller `metadata` is merged with pi-hindsight provenance, but reserved provenance keys such as `cwd`, `pi_session_file`, `source`, and `retainSource` are set by pi-hindsight and cannot be overridden.
- `hindsight_reflect` accepts `responseSchema` for structured reflection output plus `budget`, `maxTokens` (including `0`), `includeFacts`, and `includeToolCalls` when supported by Hindsight.
- Omit `bank` or pass `project` for the selected project bank.
- Pass `global` for the configured global bank.
- `hindsight_retain_global` refuses to write if global memory is disabled or missing a bank ID.

## Receipts and deletion

Explicit retain returns a receipt with:

- `bankId`
- `documentId`
- `queueJobId`
- `updateMode`

Recent receipts are saved locally and shown in the `/hindsight` TUI so exact document IDs can be found later. Document deletion happens in the Hindsight web UI.

Manual explicit memories use deterministic `pi-explicit:<session>:<hash>` document IDs and `updateMode: "replace"`, so repeating the same explicit memory updates the same document instead of appending duplicates.
