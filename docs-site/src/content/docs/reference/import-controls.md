---
title: "Import controls reference"
---

Import controls are the advanced surface for previewing and ingesting historical Pi sessions or chat transcripts. For first-time setup, prefer `/hindsight` guided setup; it can offer a dry-run-first import flow. Day-to-day imports also run from the hub (`i`).

For the concept model, see [Historical Import](/pi-hindsight/concepts/imports/). For task guidance, see [Importing sessions](/pi-hindsight/guides/importing-sessions/).

## Entry points

- `/hindsight` → `i` (import wizard; dry-run first)
- Guided setup optional import step
- Shared memory operation service (used by the TUI; no public slash import commands)

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
