# Tools and commands

## Public human command

Pi Hindsight is **TUI-first**. The only public slash command is:

```text
/hindsight
```

Open the memory hub for status, guided setup, session mode, mental models, import, flush, doctor, init, and advanced settings.

### Hub keys

| Key | Action                                                                                       |
| --- | -------------------------------------------------------------------------------------------- |
| `g` | Guided setup (profile, agent use, banks, optional mental models + import)                    |
| `m` | Session mode: `normal` / `read-only` / `ignored`                                             |
| `t` | Apply mental-model set for current **agent use** (coding vs conversation); dry-run + confirm |
| `i` | Historical import (dry-run first)                                                            |
| `f` | Flush retain queue                                                                           |
| `o` | Doctor diagnostics report                                                                    |
| `n` | Write `.pi/hindsight.json` with the selected project bank                                    |
| `d` | Deployment / connection helpers                                                              |
| `a` | Toggle advanced settings tabs                                                                |
| `q` | Close                                                                                        |

### Agent use and mental models

Config field `agentUse` is `coding` (default) or `conversation`.

- **coding** starter sets: `pi-coding-project`, `pi-coding-user`
- **conversation** starter sets: `pi-conversation-project`, `pi-conversation-user`

Legacy id `pi-user-preferences` still resolves to `pi-coding-user`.

When mental models exist on active banks and `mentalModels.inject` is true (default), their content is injected into automatic context alongside recall (ephemeral; not retained).

## Model-facing tools

These remain available for the agent:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_retain_global`
- `hindsight_reflect`

See the generated [surface reference](surface-reference.md) for parameter schemas.
