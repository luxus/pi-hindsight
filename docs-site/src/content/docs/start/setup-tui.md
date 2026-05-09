---
title: "Setup TUI"
---

`/hindsight` is the main control center. Use it before command shortcuts.

```text
/hindsight
```

The TUI shows status first, then lets you edit settings, rerun guided setup, flush queued Retain Jobs, inspect imports, and open mental model details.

## What to use it for

- first setup and profile selection
- server/base URL checks
- Project Bank and User Bank confirmation
- Retain Queue state and flushes
- import manifest/checkpoint status
- recent Retain receipts
- local config overrides
- read-only mental model inventory

Each selected setting detail includes a section-level docs link. Use that link when a field needs more context than the TUI can show.

## Guided setup

If no project config exists, `/hindsight` starts guided setup before the advanced TUI. You can rerun guided setup later with `g`.

Guided setup handles:

1. Hindsight server URL
2. memory profile
3. project and/or user bank target
4. built-in or custom bank template
5. optional dry-run-first historical import
6. optional post-import mental model refresh

Setup also prints docs links for the current area, such as [memory profiles](/pi-hindsight/start/memory-profiles/), [bank templates](/pi-hindsight/reference/bank-template-manifest/), and [imports](/pi-hindsight/guides/importing-sessions/).

## Profiles in one line

- **Project + User**: repo facts in Project memory; durable preferences in User memory.
- **Project Only**: strict repo isolation.
- **User Only**: cross-project/user memory without project memory.
- **Recall Only**: recall on, automatic retain off.

For details, see [Memory profiles](/pi-hindsight/start/memory-profiles/).

## Keyboard controls

- `h`/`l` or `<`/`>`: switch tabs
- `j`/`k`: move between settings
- `Enter`: edit selected setting
- `r`: remove selected setting's active override
- `f`: flush queued Retain Jobs
- `m`: open read-only mental model list/detail view
- `a`: toggle advanced fields
- `d`: deployment setup
- `g`: rerun guided setup
- `q`: close

## First checks

After setup, confirm:

- server is reachable
- expected profile is active
- Project Bank appears only when project memory is intended
- User Bank appears only when user memory is intended
- Retain Queue path is visible and writable
- import state is empty, previewed, imported, queued, or failed as expected

For status interpretation, see [Use `/hindsight` status](/pi-hindsight/guides/use-hindsight-status/).

## Import from the TUI first

Guided setup can offer historical import after config/template setup. That path previews first, shows progress, then asks before writing memory. Prefer it for first-time backfill.

Use command shortcuts later when you already know which session set you want to import. See [Importing sessions](/pi-hindsight/guides/importing-sessions/).
