---
title: "Import controls reference"
---

Import controls are the advanced surface for previewing and ingesting historical Pi sessions or chat transcripts. For first-time setup, prefer `/hindsight` guided setup; it can offer a dry-run-first import flow.

For the concept model, see [Historical Import](/pi-hindsight/concepts/imports/). For task guidance, see [Importing sessions](/pi-hindsight/guides/importing-sessions/).

## Commands

```text
/hindsight:import-current --dry-run
/hindsight:import-current
/hindsight:import-file /path/to/session.jsonl --dry-run --all-leaves
/hindsight:import-project-sessions --dry-run
/hindsight:import-project-sessions
```

Use `--dry-run` before writing memory. Use `--all-leaves` only when you want every fork leaf in an explicit session file.

## Tools

```text
hindsight_import({ dryRun: true })
hindsight_import_chat_transcript({ sourceFile: "/path/to/chat.jsonl", dryRun: true })
```

`hindsight_import` imports Pi session JSONL. `hindsight_import_chat_transcript` imports chat transcript JSONL into the configured User Bank by default.

## Modes

- `curated`: default filtered structured source chunks.
- `raw`: explicit raw branch import for compatibility/debugging.
- `forensic`: raw-style import that preserves artifacts such as recalled memory blocks.

Raw and forensic modes preserve legacy document IDs and payload shape.

## Curated quality profiles

- `compatible` (default): preserves the default curated import behavior.
- `strict`: opt-in stronger noise handling.

Strict applies only to `curated`. It keeps failed tool results as evidence and may keep useful tiny successful summaries/content, but drops successful tool results that are process/UI/status-like, larger than 2 KiB before summarization, or duplicate/repeated within the curated chunk.

## Dry-run metrics

Pi session dry-runs report document count, import mode/profile, raw/projected message counts, tool-output counts, signal/noise categories when available, estimated chunks, byte counts, target bank, and checkpoint/manifest paths.

Chat dry-runs report kept event count, retained user-turn count, dropped event totals, malformed-line count, target User Bank, content hash, and byte count.

## Checkpoints and manifests

Historical import writes an Import Manifest and Import Checkpoint so work is inspectable, resumable, and idempotent. Curated document IDs include profile/projection/chunk information. Raw and forensic modes preserve legacy IDs.

Changing the derived chunking profile (`turnsPerDocument` and `maxDocumentBytes`) or another document-ID namespace input creates a different deterministic ID set. Treat namespace changes as rebuilds: dry-run first, decide whether old and new imported documents should coexist, then reset relevant checkpoint/manifest or queued retain jobs only when stale IDs should not resume.

## Tool-output policy

Curated import has a successful-tool-result policy:

- `errors-only` (default): drop successful tool output and keep failed tool evidence.
- `summary`: keep bounded summaries for allowed successful tools.
- `content`: keep full content for allowed successful tools.

Tool filters still apply in `summary` and `content`, so noisy tools remain excluded unless explicitly allowed. Strict quality profile can drop additional successful tool output after filters.
