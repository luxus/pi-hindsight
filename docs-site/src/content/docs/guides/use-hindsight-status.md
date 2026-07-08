---
title: "Use /hindsight status"
description: Inspect server reachability, active banks, retain queue state, imports, and retain receipts.
---

Use `/hindsight` as the control center for runtime memory status.

## Open status

In Pi, run:

```text
/hindsight
```

The setup TUI shows:

- Hindsight server URL and reachability
- active memory profile
- Project Bank and User Bank IDs
- automatic recall/retain mode
- Retain Queue path and pending jobs
- recent retain receipts
- import manifest and checkpoint paths

## First checks

After setup, confirm:

1. the expected server URL is active
2. the expected memory profile is active
3. the Project Bank is selected for project memory
4. User Bank appears only when configured intentionally
5. Retain Queue path exists and is writable
6. recent retain receipts appear after completed agent runs

## Useful actions

From the TUI:

- flush queued retain jobs
- rerun guided setup
- open mental model details
- remove selected config overrides
- inspect deployment setup fields

From the hub: press `f` to flush the retain queue, `i` for import, `o` for doctor. Last-recall debug snapshots are opt-in local files under `.pi/hindsight/` when `recall.storeLastRecall` is enabled.

For first-time imports, prefer guided setup's dry-run-first import prompt. For later imports, see [Importing sessions](./importing-sessions/). See [Tools and commands](../reference/tools-and-commands/) for the public surface.
