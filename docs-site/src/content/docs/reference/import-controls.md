---
title: "Import controls reference"
---

Import controls preview and ingest historical Pi sessions or gateway transcripts. For the concept model, see [Historical Import](/pi-hindsight/concepts/imports/).

## Commands

```text
/hindsight:import-current --dry-run
/hindsight:import-current
/hindsight:import-file /path/to/session.jsonl --dry-run --all-leaves
/hindsight:import-project-sessions --dry-run
/hindsight:import-project-sessions
```

Use `--dry-run` before writing memory.

## Tools

```text
hindsight_import({ dryRun: true })
hindsight_import_gateway({ sourceFile: "/path/to/gateway.jsonl", dryRun: true })
```

`hindsight_import` imports Pi session JSONL. `hindsight_import_gateway` imports gateway/chat transcript JSONL into the configured user memory bank by default.

## Modes

- `curated`: default filtered structured source chunks.
- `raw`: explicit raw branch import for compatibility/debugging.
- `forensic`: raw-style import that preserves artifacts such as recalled memory blocks.

Raw and forensic modes preserve legacy document IDs and payload shape.

## Curated quality profiles

- `compatible` (default): preserves current curated import behavior.
- `strict`: explicit opt-in profile for stronger curated noise handling.

Strict applies only to `curated`. It keeps failed tool results as evidence and may keep useful tiny successful summaries/content, but drops successful tool results that are process/UI/status-like, larger than 2 KiB before summarization, or duplicate/repeated within the curated chunk. Raw and forensic ignore `import.qualityProfile`.

## Dry-run metrics

Pi session dry-runs report items such as:

- document count
- import mode/profile
- raw message count
- curated projection count
- dropped non-error tool-result count
- kept tool-error count
- kept signal categories (`keptSignals=`), when curated reason counts exist
- dropped noise categories (`droppedNoise=`), when curated reason counts exist
- estimated chunk count
- byte counts
- target bank
- checkpoint/manifest paths

Gateway dry-runs report items such as:

- kept event count
- retained user-turn count
- dropped event count/type totals
- malformed-line count
- target user bank
- content hash
- byte count

## Checkpoints and manifests

Historical import writes an Import Manifest and Import Checkpoint so work is inspectable, resumable, and idempotent. Curated document IDs include profile/projection/chunk information. Raw and forensic modes preserve legacy IDs.

Changing the derived chunking profile (`turnsPerDocument` and `maxDocumentBytes`) or another document-ID namespace input creates a different deterministic ID set. Reimporting after such a change writes new imported documents rather than replacing the previous namespace. `import.qualityProfile` and successful-tool-result settings change retained content or metadata, but they do not create a separate document-ID namespace. Treat namespace changes as rebuilds: dry-run first, clean up old imported documents if you do not want both namespaces, and reset relevant checkpoint/manifest or queued retain jobs when stale IDs should not resume.

Curated import has a successful-tool-result policy:

- `errors-only` (default): drop successful tool output and keep failed tool evidence.
- `summary`: keep bounded summaries for allowed successful tools.
- `content`: keep full content for allowed successful tools.

Tool filters still apply in `summary` and `content`, so noisy tools remain excluded unless explicitly allowed. Strict quality profile can drop additional successful tool output after filters.
