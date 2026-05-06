---
title: "Historical Import"
---

**Import** is the historical session ingestion path. It parses Pi JSONL sessions or gateway transcripts, builds deterministic source documents, queues Retain Jobs, and records manifests/checkpoints.

Import is not generic summarization. Curated import keeps filtered structured source material so Hindsight still receives evidence with provenance.

## Quality vocabulary

- **Durable signal**: raw source evidence worth keeping because it records facts, decisions, tasks, bugs, errors, verification, issues, PRs, commits, blockers, follow-ups, or workflow outcomes.
- **Import noise**: transcript material that should not become source truth by default, such as streaming UI records, process/status chatter, repeated successful output, large file reads, and replay artifacts.
- **Tool evidence**: tool output with memory value. Failed tool results are usually useful evidence when kept concise; large successful tool output is usually noise. Curated import defaults to `toolResults: "errors-only"`; use `summary` or `content` only for deliberate low-noise imports.
- **Workflow signal**: project execution evidence such as issue selection, branch/PR/commit references, review decisions, CI/smoke checks, release gates, blockers, and follow-ups.
- **Recall contamination**: retaining or importing prior Recall Blocks or Last-Recall artifacts as if they were new source evidence. Curated import and live retain must avoid it.

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
