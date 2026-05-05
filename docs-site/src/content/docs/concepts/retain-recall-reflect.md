---
title: "Retain, Recall, and Reflect"
---

# Retain, Recall, and Reflect

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

## Reflect

**Reflect** asks Hindsight to reason over stored memory for a specific question.

Use Reflect for:

- pattern investigation
- contradictions
- design history
- “why did this happen?” questions
- memory-grounded synthesis

Do not route all automatic memory behavior through Reflect. Pi Hindsight exposes Reflect as an explicit tool/command path.

## Mental models

Mental models are saved Hindsight reflect responses for recurring questions. They are useful for stable project or user context, but they are not replacements for source import material.

Pi Hindsight can list mental models and offer explicit refresh/create flows after imports. Routine session retain does not silently create or refresh mental models.
