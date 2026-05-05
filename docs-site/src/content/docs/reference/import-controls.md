---
title: "Import controls reference"
---

Import controls preview and ingest historical Pi sessions or gateway transcripts. For the concept model, see [Historical Import](/concepts/imports/).

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

## Dry-run metrics

Pi session dry-runs report items such as:

- document count
- import mode/profile
- raw message count
- curated projection count
- dropped non-error tool-result count
- kept tool-error count
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
