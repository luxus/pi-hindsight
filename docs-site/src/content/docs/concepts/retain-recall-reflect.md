---
title: "Retain, Recall, and Reflect"
---

Pi Hindsight uses the three core Hindsight operations without collapsing them into one generic “memory” action.

```text
Retain  = store source material
Recall  = retrieve relevant memory candidates
Reflect = reason over memory for a question
```

## Retain

**Retain** writes raw rich content to Hindsight.

Pi Hindsight retains structured session deltas, explicit user-provided content, and curated historical import chunks. Retain should preserve source evidence rather than pre-summarizing it.

Important fields:

- `context`: what kind of content is being retained
- `document_id`: stable source/document identity
- `update_mode`: `append` for live sessions, `replace` for deterministic reimports
- `tags`: scope and visibility
- `metadata`: provenance and links back to source records

## Recall

**Recall** retrieves memory candidates before answer generation.

Automatic recall runs in Pi's `context` hook. It injects an ephemeral Recall Block into provider context. That block is not written into the Pi transcript by this extension and must not be retained back into Hindsight.

Recall returns candidates, not final answers.

Before rendering, Pi Hindsight drops blank memories, duplicate memory text, and prior Hindsight recall artifacts. This keeps Recall Blocks useful and prevents recall contamination from re-entering provider context.

## Reflect

**Reflect** asks Hindsight to reason over stored memory for a specific question.

Use Reflect for:

- pattern investigation
- contradictions
- design history
- “why did this happen?” questions
- memory-grounded synthesis

Do not route all automatic memory behavior through Reflect. Pi Hindsight exposes Reflect as an explicit tool/command path.

## Core quality before admin surfaces

Pi Hindsight's release path is deliberately narrow: make Retain, Recall, Reflect, and Import reliable before adding Hindsight administration or exploration surfaces.

Current priority:

- preserve durable source evidence without summaries
- keep automatic recall scoped, bounded, and ephemeral
- keep reflect explicit and memory-grounded
- make curated imports signal-preserving and low-noise by default
- expose enough status, receipts, and last-recall visibility to debug the core path safely

Deferred unless a new issue reopens scope:

- audit-log tools
- webhook tools
- graph or entity browsers
- document or memory-unit browsers
- operation-management tools
- destructive bank administration UI

These Hindsight features can still inform compatibility work, but they should not displace core memory quality work.

## Mental models

Mental models are saved Hindsight reflect responses for recurring questions. They are useful for stable project or user context, but they are not replacements for source import material.

Pi Hindsight can list mental models and offer explicit refresh/create flows after imports. Routine session retain does not silently create or refresh mental models.
