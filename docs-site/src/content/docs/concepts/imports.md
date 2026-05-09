---
title: "Historical Import"
---

Import is optional historical backfill. It is not required for live memory after setup.

Pi Hindsight has two import families:

- **Pi session import** for project/coding sessions stored as Pi JSONL.
- **Chat transcript import** for user conversation history stored as chat transcript JSONL.

The `/hindsight` guided setup flow can offer import after bank/template setup and previews before writing memory. Use the command and tool surfaces when you need repeatable or explicit-file imports.

## What import writes

Import builds deterministic source documents, sends them through Retain, and records local checkpoint/manifest state. The retained content is filtered structured source evidence, not a summary.

Default files:

```text
.pi/hindsight/import-manifest.json
.pi/hindsight/import-checkpoint.json
```

## Quality vocabulary

- **Durable signal**: raw source evidence worth keeping because it records facts, decisions, tasks, bugs, errors, verification, issues, PRs, commits, blockers, follow-ups, or workflow outcomes.
- **Import noise**: transcript material that should not become source truth by default, such as streaming UI records, process/status chatter, repeated successful output, large file reads, and replay artifacts.
- **Tool evidence**: tool output with memory value. Failed tool results are usually useful evidence when concise; large successful output is usually noise.
- **Workflow signal**: project execution evidence such as issue selection, branch/PR/commit references, review decisions, CI/smoke checks, release gates, blockers, and follow-ups.
- **Recall contamination**: retaining prior Recall Blocks or Last-Recall artifacts as if they were new source evidence.

## Modes

- `curated`: default high-signal projection for normal historical imports.
- `raw`: compatibility/debug escape hatch.
- `forensic`: audit/recovery mode that can preserve normally filtered artifacts.

Curated import defaults to failed-tool evidence only for tool output. Use successful-tool summaries/content only for deliberate low-noise imports.

## Dry-run first

Historical import should be previewed before writing. Dry-run reports include counts for raw/projected messages, dropped tool output, kept errors, estimated chunks, malformed lines, target banks, and checkpoint/manifest paths.

## Provenance

Import records provenance in tags and metadata. Use tags for filtering and metadata for traceability back to source sessions, branches, conversations, and chunks.

## More detail

For task steps and command/tool examples, see [Importing sessions](/pi-hindsight/guides/importing-sessions/) and [Import controls reference](/pi-hindsight/reference/import-controls/).
