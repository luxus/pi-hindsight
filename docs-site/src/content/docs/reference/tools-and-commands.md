---
title: "Tools and commands"
---

For generated details of registered tools and editable config fields, see [Generated surface reference](/pi-hindsight/reference/surface-reference/). For related concepts, see [Retain, Recall, and Reflect](/pi-hindsight/concepts/retain-recall-reflect/) and [Memory Banks](/pi-hindsight/concepts/memory-banks/).

`/hindsight` is the main control center. Commands are convenience shortcuts and escape hatches for advanced workflows.

## Main command

```text
/hindsight
```

Shows memory status, selected banks, config facts, retain queue status, import status, and recent retain receipts. It also exposes setup/config editing actions. Press `f` to flush queued retain jobs from the TUI. Press `m` to open the read-only mental model list/detail view; use the Hindsight web interface for create, edit, refresh, or delete.

## Setup and config

```text
/hindsight:init
```

Writes `.pi/hindsight.json` with the current project bank ID and Hindsight base URL.

The `hindsight_configure` tool can write config from agents. Prefer `/hindsight` for interactive setup.

## Import

```text
/hindsight:import-current --dry-run
/hindsight:import-current
/hindsight:import-file /path/to/session.jsonl --dry-run --all-leaves
/hindsight:import-project-sessions --dry-run
/hindsight:import-project-sessions
```

Use dry-run before non-dry-run imports. See [Import controls reference](/pi-hindsight/reference/import-controls/) and [Importing sessions](/pi-hindsight/guides/importing-sessions/).

## Queue and snapshots

```text
/hindsight:flush
/hindsight:last-recall
/hindsight:last-recall --json
/hindsight:recall-cleanup
/hindsight:recall-cleanup <session.jsonl> --prune
```

`/hindsight:flush` flushes queued retain jobs. `/hindsight:last-recall` reads the opt-in local recall snapshot. Recall cleanup reports or prunes accidentally persisted `<hindsight-memory>` transcript lines.

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

Required tools:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_reflect`

Additional tools:

- `hindsight_configure`
- `hindsight_get_bank_config`
- `hindsight_reset_bank_config`
- `hindsight_list_directives`
- `hindsight_get_directive`
- `hindsight_create_directive`
- `hindsight_update_directive`
- `hindsight_delete_directive`
- `hindsight_get_bank_template_schema`
- `hindsight_export_bank_template`
- `hindsight_import`
- `hindsight_import_gateway`
- `hindsight_retain_global`
- `hindsight_route_memory`
- `hindsight_retain_receipts`
- `hindsight_delete_document`

Tool notes:

- `hindsight_recall` accepts `queryTimestamp`.
- `hindsight_retain` accepts `entities`.
- `hindsight_reflect` accepts `responseSchema` for structured reflection output.
- Omit `bank` or pass `project` for the selected project bank.
- Pass `global` for the configured global bank.
- `hindsight_retain_global` refuses to write if global memory is disabled or missing a bank ID.
- `hindsight_delete_document` requires exact bank, exact document ID, and `confirm: true`.

## Receipts and deletion

Explicit retain returns a receipt with:

- `bankId`
- `documentId`
- `queueJobId`
- `updateMode`

Recent receipts are saved locally and exposed through `hindsight_retain_receipts` so exact document IDs can be found later.

Manual explicit memories use deterministic `pi-explicit:<session>:<hash>` document IDs and `updateMode: "replace"`, so repeating the same explicit memory updates the same document instead of appending duplicates.
