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
- Project Bank and Global/User Bank IDs
- automatic recall/retain mode
- Retain Queue path and pending jobs
- recent retain receipts
- import manifest and checkpoint paths

## First checks

After setup, confirm:

1. the expected server URL is active
2. the expected memory profile is active
3. the Project Bank is selected for project memory
4. Global/User Bank appears only when configured intentionally
5. Retain Queue path exists and is writable
6. recent retain receipts appear after completed agent runs

## Useful actions

From the TUI:

- flush queued retain jobs
- rerun guided setup
- open mental model details
- remove selected config overrides
- inspect deployment setup fields

Use command shortcuts when you do not need the full TUI:

```text
/hindsight:flush
/hindsight:last-recall
/hindsight:import-current --dry-run
/hindsight:import-project-sessions --dry-run
```

See [Tools and commands](../reference/tools-and-commands/) for the full command surface.
