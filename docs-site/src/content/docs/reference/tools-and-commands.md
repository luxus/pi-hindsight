---
title: "Tools and commands"
---

For a generated reference of registered tools, commands, and editable config fields, see [Generated surface reference](/pi-hindsight/reference/surface-reference/).

## Public human commands

Pi Hindsight is **TUI-first**. Public slash commands:

```text
/hindsight
/hindsight:next-opt-out
```

`/hindsight` opens the memory hub for status, guided setup, session mode, mental models, import, flush, doctor, init, and advanced settings.  
`/hindsight:next-opt-out` skips automatic retain for the next agent run (also hub key `x`).

### Hub keys

| Key | Action                                                                                       |
| --- | -------------------------------------------------------------------------------------------- |
| `g` | Guided setup (profile, agent use, banks, optional mental models + import)                    |
| `m` | Session mode: `normal` / `read-only` / `ignored`                                             |
| `x` | Next-opt-out: skip automatic retain for the next agent run                                   |
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

When mental models exist on active banks and `mentalModels.inject` is true (default), their content is injected into automatic context alongside recall (ephemeral; not retained). See [Starter mental model suggestions](/pi-hindsight/concepts/starter-mental-model-suggestions/).

## Explicit tools

Pi exposes exactly four memory tools:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_retain_global`
- `hindsight_reflect`

Everything else — bank config/profile administration, document/entity/graph/tag browsing, memory inspection, consolidation control, and operation management — lives in the Hindsight control-plane web UI, except for the bundled mental-model templates applied from the hub (`t`).

Tool notes:

- In Pi's interactive TUI, memory tool outputs share one normalized text renderer and support the normal tool-output expansion toggle (`Ctrl+O` by default). Short outputs render in the same model without needing to fold; long outputs render as compact previews until expanded.
- `hindsight_recall` accepts `queryTimestamp` plus advanced one-off controls: `types`, `budget`, `maxTokens` (including `0`), `includeChunks`, `recallChunksMaxTokens`, `includeSourceFacts`, `maxSourceFactsTokens`, `includeEntities`, and `trace`.
- `hindsight_retain` and `hindsight_retain_global` accept explicit Hindsight retain options: `entities`, `documentId`, `timestamp` (including literal `unset`), `metadata`, `updateMode`, `observationScopes`, `documentTags`, and `async`.
- `hindsight_reflect` accepts `responseSchema` for structured reflection output plus `budget`, `maxTokens` (including `0`), `includeFacts`, and `includeToolCalls` when supported by Hindsight.
