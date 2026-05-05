---
title: "Historical Import"
---

# Historical Import

**Import** is the historical session ingestion path. It parses Pi JSONL sessions or gateway transcripts, builds deterministic source documents, queues Retain Jobs, and records manifests/checkpoints.

Import is not generic summarization. Curated import keeps filtered structured source material so Hindsight still receives evidence with provenance.

## Modes

- `curated`: default high-signal projection for normal historical imports.
- `raw`: explicit raw branch import for compatibility/debugging.
- `forensic`: raw-style import that preserves recalled memory blocks and other artifacts for audit use.

Raw and forensic modes preserve legacy document IDs and payload shape.

## Profiles

Setup-selected bank templates can inform import defaults:

- coding/project template → repo-scoped Pi agent sessions
- assistant/personal template → gateway/chat transcripts
- general/user template → conversation/open-thread import

Source types are explicit. Pi Hindsight does not silently mix repo sessions and gateway transcripts.

## Dry-run first

Historical import should be previewed before writing. Dry-run reports include counts for raw/projected messages, dropped tool output, kept errors, estimated chunks, malformed lines, target banks, and checkpoint/manifest paths.

## Provenance

Import records provenance in tags and metadata. Use tags for filtering and metadata for traceability back to source sessions, branches, conversations, and chunks.
