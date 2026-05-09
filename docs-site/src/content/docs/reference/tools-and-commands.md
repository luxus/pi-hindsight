---
title: "Tools and commands"
---

For a generated reference of registered tools, commands, and editable config fields, see [Generated surface reference](/pi-hindsight/reference/surface-reference/).

`/hindsight` is the main control center. Commands are convenience shortcuts and escape hatches for advanced workflows.

## Main command

```text
/hindsight
```

Shows memory status, selected banks, config facts, retain queue status, import status, and recent retain receipts. Status activity can distinguish recall, retain, and import work, including `importing`, `imported`, `import-queued`, and `import-failed`. It also exposes setup/config editing actions. Press `f` to flush queued retain jobs from the TUI. Press `m` to open the read-only mental model list/detail view; use the Hindsight web interface for create, edit, refresh, or delete.

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

Use dry-run before non-dry-run imports. See [Import controls](/pi-hindsight/reference/import-controls/) and [Importing sessions](/pi-hindsight/guides/importing-sessions/).

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

Required tools:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_reflect`

Additional tools:

- `hindsight_configure`
- `hindsight_get_bank_config`
- `hindsight_update_bank_config`
- `hindsight_get_bank_profile`
- `hindsight_update_bank_profile`
- `hindsight_update_bank_disposition`
- `hindsight_add_bank_background`
- `hindsight_reset_bank_config`
- `hindsight_list_directives`
- `hindsight_get_directive`
- `hindsight_create_directive`
- `hindsight_update_directive`
- `hindsight_delete_directive`
- `hindsight_get_bank_template_schema`
- `hindsight_export_bank_template`
- `hindsight_import_bank_template`
- `hindsight_import`
- `hindsight_import_seed_content`
- `hindsight_import_chat_transcript`
- `hindsight_retain_global`
- `hindsight_route_memory`
- `hindsight_retain_files`
- `hindsight_retain_receipts`
- `hindsight_delete_document`
- `hindsight_list_documents`
- `hindsight_get_document`
- `hindsight_update_document_tags`
- `hindsight_list_entities`
- `hindsight_get_entity`
- `hindsight_regenerate_entity`
- `hindsight_get_graph`
- `hindsight_get_entity_graph`
- `hindsight_list_tags`
- `hindsight_list_mental_models`
- `hindsight_get_mental_model`
- `hindsight_create_mental_model`
- `hindsight_promote_reflect_query_to_mental_model`
- `hindsight_update_mental_model`
- `hindsight_delete_mental_model`
- `hindsight_get_mental_model_history`
- `hindsight_refresh_mental_model`
- `hindsight_trigger_consolidation`
- `hindsight_recover_consolidation`
- `hindsight_clear_observations`
- `hindsight_list_operations`
- `hindsight_cancel_operation`
- `hindsight_retry_operation`
- `hindsight_list_memories`
- `hindsight_get_memory`
- `hindsight_get_chunk`
- `hindsight_get_memory_history`
- `hindsight_delete_memory_observations`

Tool notes:

- `hindsight_recall` accepts `queryTimestamp` plus advanced one-off controls: `types`, `budget`, `maxTokens` (including `0`), `includeChunks`, `recallChunksMaxTokens`, `includeSourceFacts`, `maxSourceFactsTokens`, `includeEntities`, and `trace`.
- `hindsight_retain` and `hindsight_retain_global` accept explicit Hindsight retain options: `entities`, `documentId`, `timestamp` (including literal `unset`), `metadata`, `updateMode`, `observationScopes`, `documentTags`, and `async`. `observationScopes` accepts `per_tag`, `combined`, `all_combinations`, or explicit string groups. Hindsight supports `documentTags` for compatibility, but upstream marks it deprecated; prefer normal `tags` unless document-level interop requires it.
- For `updateMode: "append"`, use a stable `documentId` when continuing a known document. If omitted, pi-hindsight still uses its deterministic explicit-retain document ID; repeated calls only append together when content/context/session produce the same ID.
- Async retain responses include Hindsight operation IDs when the server returns them; use `hindsight_list_operations`, `hindsight_cancel_operation`, and `hindsight_retry_operation` to inspect or manage those jobs.
- Caller `metadata` is merged with pi-hindsight provenance, but reserved provenance keys such as `cwd`, `pi_session_file`, `source`, and `retainSource` are set by pi-hindsight and cannot be overridden.
- `hindsight_reflect` accepts `responseSchema` for structured reflection output plus `budget`, `maxTokens` (including `0`), `includeFacts`, and `includeToolCalls` when supported by Hindsight.
- Omit `bank` or pass `project` for the selected project bank.
- Pass `global` for the configured global bank.
- `hindsight_retain_global` refuses to write if global memory is disabled or missing a bank ID.
- `hindsight_delete_document` requires exact bank, exact document ID, and `confirm: true`.
- `hindsight_update_bank_config` accepts raw Hindsight bank config override fields and requires `confirm: true`. High-value fields include retain extraction/chunking, observation/consolidation limits, reflect source-fact budgets, MCP tool allowlists, retain strategies, and recall budget mapping fields. Keep server-admin or credential-like fields out of Pi local config unless Hindsight documents them as per-bank safe overrides.
- `hindsight_import_bank_template` defaults to dry-run. Applying requires `dryRun: false` plus `confirmApply: true` and exactly one source (`sourceFile` or `manifestJson`).
- `hindsight_import_seed_content` imports explicit `.md`, `.txt`, and `.json` files or directories into the project bank by default. It defaults to dry-run, uses deterministic `pi-seed-import:<relative-path>` document IDs, and writes with `updateMode: "replace"` for idempotent reimports.
- `hindsight_retain_files` uses Hindsight native file retain for PDFs, Office files, images, audio, and other server-supported files. It returns async operation details; inspect progress with `hindsight_list_operations`.
- Document/entity/graph/tag inspection tools present compact IDs, tags, metadata/provenance keys, timestamps, and counts when Hindsight returns them. They do not print giant source payloads by default beyond bounded JSON detail.
- `hindsight_update_document_tags`, `hindsight_regenerate_entity`, `hindsight_update_bank_config`, `hindsight_update_bank_profile`, `hindsight_update_bank_disposition`, and `hindsight_add_bank_background` are admin mutations and require `confirm: true`.
- Bank profile/background/disposition tools only call current supported Hindsight endpoints. They do not expose bank-wide destructive operations. Roll back profile/disposition/background changes by reapplying the previous values from the returned `before` profile or the Hindsight web UI.
- `hindsight_cancel_operation` requires exact operation ID and `confirm: true`; it is intended for pending operations.
- Mental-model tools expose list/get/create/update/delete/history/refresh. Deletes require `confirm: true`; refresh can return async operation IDs.
- Consolidation tools can trigger and recover server consolidation work. `hindsight_clear_observations` is bank-wide and destructive, so it requires `confirm: true`; prefer `hindsight_delete_memory_observations` for one-memory repair.
- `hindsight_delete_memory_observations` requires exact memory ID and `confirm: true`. Bank-wide memory clear/delete-all is intentionally not exposed.
- Memory inspection tools use current documented REST endpoints: list memory units, fetch a memory, fetch a chunk by ID, fetch memory history when the server supports it, and delete observations for one memory when supported.

## Receipts and deletion

Explicit retain returns a receipt with:

- `bankId`
- `documentId`
- `queueJobId`
- `updateMode`

Recent receipts are saved locally and exposed through `hindsight_retain_receipts` so exact document IDs can be found later.

Manual explicit memories use deterministic `pi-explicit:<session>:<hash>` document IDs and `updateMode: "replace"`, so repeating the same explicit memory updates the same document instead of appending duplicates.
