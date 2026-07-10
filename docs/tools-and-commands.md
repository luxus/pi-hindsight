# Tools and commands

## Public human surface

Pi Hindsight is **TUI-first**. Public slash commands:

```text
/hindsight
/hindsight:next-opt-out
```

- `/hindsight` opens a **thin** memory hub: status, short guided setup, and emergency actions (mode, next-opt-out, flush, doctor). Day-to-day mission/mental-model/config edits belong to agent tools, not a TUI field farm.
- `/hindsight:next-opt-out` skips automatic retain for the next agent run only (also available as hub key `x`).

### Hub keys

| Key | Action                                                                |
| --- | --------------------------------------------------------------------- |
| `g` | Guided setup (profile, agent use, banks, optional templates + import) |
| `m` | Session mode: `normal` / `read-only` / `ignored`                      |
| `x` | Next-opt-out: skip automatic retain for the next agent run            |
| `f` | Flush retain queue                                                    |
| `o` | Doctor diagnostics report (includes status tones)                     |
| `n` | Write `.pi/hindsight.json` with the selected project bank             |
| `d` | Deployment / connection helpers                                       |
| `i` | Historical import (dry-run first)                                     |
| `t` | Apply starter bank template / mental-model set (dry-run first)        |
| `a` | Toggle advanced settings (prefer agent tools for day-to-day edits)    |
| `q` | Close                                                                 |

Day-to-day mission, mental-model, and config edits: prefer agent control-plane tools (ADR-005 / `hindsight_status`, `hindsight_bank`, `hindsight_mental_model` when registered); the advanced TUI farm is an escape hatch, not the primary surface.

### Agent use and mental models

Config field `agentUse` is `coding` (default) or `conversation`.

- **coding** starter sets: `pi-coding-project`, `pi-coding-user`
- **conversation** starter sets: `pi-conversation-project`, `pi-conversation-user`

Legacy id `pi-user-preferences` still resolves to `pi-coding-user`.

When mental models exist on active banks and `mentalModels.inject` is true (default), their content is injected into automatic context alongside recall (ephemeral; not retained). List results are cached for `mentalModels.cacheTtlMs` (default 5 minutes).

## Model-facing tools

These remain available for the agent:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_retain_global`
- `hindsight_reflect`

See the generated [surface reference](surface-reference.md) for parameter schemas.
