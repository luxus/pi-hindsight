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

`/hindsight` opens a **thin** memory hub: status, short guided setup, and emergency actions (mode, next-opt-out, flush, doctor). Day-to-day mission/mental-model/config edits belong to agent tools, not a TUI field farm.  
`/hindsight:next-opt-out` skips automatic retain for the next agent run (also hub key `x`).

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

Day-to-day mission, mental-model, and config edits: prefer agent control-plane tools (ADR-005); the advanced TUI farm is an escape hatch, not the primary surface.

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
