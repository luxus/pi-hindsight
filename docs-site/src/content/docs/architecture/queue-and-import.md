---
title: "Queue and import architecture"
---

# Queue and import architecture

Retain delivery and historical import both prioritize durability, provenance, and deterministic replay.

## Retain Queue

The Retain Queue writes jobs to disk before delivery. It handles retry, stale locks, malformed line quarantine, bounded shutdown flushes, and dead-letter rollover.

See [Retain Queue durability](../concepts/queue-durability/) for user-facing concepts.

## Import architecture

Historical import separates parsing, projection, planning, retaining, checkpointing, and presentation.

Important boundaries:

- parsers read source formats
- projection selects high-signal source content
- retain builders preserve structured source material
- checkpoint/manifest code owns resumability and idempotency
- operation presenters report dry-run and write results

Curated imports may chunk by user turns. Raw and forensic imports preserve legacy document IDs and payload shape.

See [Historical Import](../concepts/imports/) and [Import controls reference](../reference/import-controls/).
