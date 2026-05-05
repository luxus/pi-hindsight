---
title: "Setup TUI"
---

Run the setup TUI from Pi:

```text
/hindsight
```

The TUI shows:

- memory status
- selected Project Bank and optional Global/User Bank
- Hindsight server reachability
- Retain Queue state
- import state
- recent Retain receipts
- editable local Pi configuration fields
- read-only mental model inventory

## Guided setup

If no project config exists, `/hindsight` starts guided setup before the advanced TUI.

Guided setup helps you choose:

1. memory profile
2. project and/or user bank target
3. built-in or custom bank template
4. optional dry-run-first historical import
5. optional post-import mental model refresh

Bank templates and mental models are Hindsight bank-owned settings. Pi Hindsight does not store mission text or directive definitions as normal Pi JSON source of truth.

## Keyboard controls

- `h`/`l` or `<`/`>`: switch tabs
- `j`/`k`: move between settings
- `Enter`: edit selected setting
- `r`: remove the selected setting's active override
- `f`: flush queued Retain Jobs
- `m`: open the read-only mental model list/detail view
- `d`: deployment setup
- `g`: rerun guided setup

## First checks

After setup, confirm:

- memory is enabled
- expected profile is active
- expected Project Bank is selected
- optional Global/User Bank is selected only when intended
- Hindsight server is reachable
- Retain Queue path is visible

Preview imports before writing memory:

```text
/hindsight:import-current --dry-run
/hindsight:import-project-sessions --dry-run
```
