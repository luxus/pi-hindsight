---
title: "Setup TUI"
---

`/hindsight` is the main control center for day-to-day memory ops. There are no separate public slash commands for mode, import, templates, flush, or doctor — use the hub keys.

```text
/hindsight
```

The hub shows status first (profile, agent use, banks, queue, receipts). Press `a` for advanced settings tabs.

## What to use it for

- first setup and profile selection
- agent use (coding vs conversation / real-life) for mental-model sets
- server/base URL checks
- Project Bank and User Bank confirmation
- provision starter mental models (`t`)
- Retain Queue flushes (`f`)
- historical import (`i`)
- doctor diagnostics (`o`)
- session memory mode (`m`)

## Guided setup

If no project config exists, `/hindsight` offers:

- **Guided setup** — configure profile, banks, optional mental models and import
- **Open hub** — open status/settings without finishing setup first
- **Ignore this repo** — durable opt-out: writes project config with `enabled: false`, `setupComplete: true`, and `status.style: "off"`. Automatic memory, status bar, and tool calls stay off; `/hindsight` remains available to re-enable (hub **enabled** field / edit `.pi/hindsight.json`)
- **Skip for now** — dismiss only this prompt; does not write config

Rerun guided setup later with `g`.

Guided setup handles:

1. **server health check** — probe configured URL (fallback `http://localhost:8888`); if unreachable and no API key, offer `HINDSIGHT_API_KEY` env setup (restart required if the env is not in this process); if a key is set, offer an alternate Cloud/self-hosted base URL; docs links shown on this screen. Offline continue skips mental models and import.
2. memory profile
3. **agent use** (coding vs conversation)
4. project and/or user bank target (existing vs create; one-line `Server: … · Bank: …` status)
5. optional starter mental models (dry-run + confirm; skipped offline / when catalog already present)
6. optional dry-run-first historical import (skipped offline)

Setup also prints docs links for the current area, such as [memory profiles](/pi-hindsight/start/memory-profiles/) and [imports](/pi-hindsight/guides/importing-sessions/).

## Profiles in one line

- **Project + User**: repo facts in Project memory; durable preferences in User memory.
- **Project Only**: strict repo isolation.
- **User Only**: cross-project/user memory without project memory.
- **Recall Only**: recall on, automatic retain off.

For details, see [Memory profiles](/pi-hindsight/start/memory-profiles/).

## Keyboard controls

- `g`: guided setup
- `m`: session mode
- `x`: next-opt-out (skip automatic retain for next run)
- `t`: mental models (agent-use aware)
- `i`: import
- `f`: flush queue
- `o`: doctor
- `n`: init project config
- `d`: deployment setup
- `a`: toggle advanced settings tabs
- `h`/`l` or `<`/`>`: switch tabs (advanced)
- `j`/`k`: move between settings (advanced)
- `Enter`: edit selected setting
- `r`: reset selected override
- `q`: close

Slash alias for next-opt-out: `/hindsight:next-opt-out`.

## First checks

After setup, confirm:

- server is reachable
- expected profile and agent use are active
- Project Bank appears only when project memory is intended
- User Bank appears only when user memory is intended
- mental models inject is on if you want them in context
- Retain Queue path is visible and writable

For status interpretation, see [Use `/hindsight` status](/pi-hindsight/guides/use-hindsight-status/).

## Import from the TUI

Guided setup and hub key `i` preview first, then ask before writing memory. Prefer that for first-time backfill. See [Importing sessions](/pi-hindsight/guides/importing-sessions/).
