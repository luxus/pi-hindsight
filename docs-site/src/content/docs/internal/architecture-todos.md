---
title: "Architecture Notes"
---

These notes record deepening work completed after the mission/global-memory pass and the remaining conditions for reopening broader architecture changes.

## Memory routing

- `globalRetain.mode`/`userRetain.mode` is `"explicit-only"` in every profile; automatic retain always targets the Project Bank only. The heuristic memory router that used to classify content into project/global/both/skip was removed per ADR 004; User Bank writes are always explicit (tool or command).

## Config editing

- Config editing registry owns field metadata, layer/source display composition, input parsing, input defaults, and patch intent builders. Adding one setting should usually touch the registry plus config writer tests, not a separate action switch.

## Document deletion UX

- Recent explicit retain receipts are persisted and surfaced in `/hindsight` status facts so users can find exact document IDs for deletion in the Hindsight web UI.

## Historical import queue seam

- Import delivery now has an import-specific queue seam, records queued-but-not-delivered imports as `queued` in checkpoints/results, and normalizes equivalent cwd paths before project-scope checks.
