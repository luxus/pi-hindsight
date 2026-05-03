# Architecture TODOs

These are deferred deepening opportunities identified after the mission/global-memory work.

## Memory routing

- Keep `globalRetain.mode = "explicit-only"` as the default.
- Router mode is explicit opt-in and now routes automatic retain through a mission-aware Adapter before enqueueing project/global/both/skip writes.
- Evaluation fixtures cover project/global/both/skip decisions. Future work: expand fixtures and add an LLM-backed Adapter behind the same Interface if heuristic quality is not enough.

## Config editing

- Config editing registry owns field metadata, layer/source display composition, input parsing, input defaults, and patch intent builders. Adding one setting should usually touch the registry plus config writer tests, not a separate action switch.

## Document deletion UX

- Recent explicit retain receipts are persisted, available through `hindsight_retain_receipts`, and surfaced in `/hindsight` status facts so users can find exact document IDs for deletion.

## Historical import queue seam

- Import delivery now has an import-specific queue seam, records queued-but-not-delivered imports as `queued` in checkpoints/results, and normalizes equivalent cwd paths before project-scope checks.
