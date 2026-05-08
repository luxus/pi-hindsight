---
title: "Setup TUI"
---

`/hindsight` is the main control center. Use it before reaching for command shortcuts.

```text
/hindsight
```

The TUI shows:

- memory profile and enablement
- selected Project Bank and optional User Bank
- Hindsight server reachability
- Retain Queue state and flush action
- import manifest/checkpoint state
- recent Retain receipts
- editable local Pi configuration fields
- read-only mental model inventory

## Guided setup

If no project config exists, `/hindsight` starts guided setup before the advanced TUI. You can rerun guided setup later with `g`.

Guided setup asks for:

1. Hindsight server URL
2. memory profile
3. project and/or user bank target
4. built-in or custom bank template
5. optional dry-run-first historical import
6. optional post-import mental model refresh

Profiles decide which config scopes are written:

- **Project + User** writes repo project-memory settings plus reusable user-bank settings in global Pi config.
- **Project Only** writes repo project-memory settings only.
- **User Only** disables project memory and writes reusable user-bank settings in global Pi config.
- **Recall Only** keeps automatic recall on and automatic retain off.

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

- server is reachable
- expected profile is active
- Project Bank appears only when project memory is intended
- User Bank appears only when user memory is intended
- Retain Queue path is visible and writable
- import state is empty, previewed, imported, queued, or failed as expected

## Import from the TUI first

Guided setup can offer historical import after config/template setup. That path previews first, then asks before writing memory. Prefer it for first-time backfill.

Use command shortcuts later when you already know which session set you want to import. See [Importing sessions](/pi-hindsight/guides/importing-sessions/).
