---
title: "Lifecycle and scope"
---

Pi Hindsight maps documented Pi extension hooks to Hindsight memory operations.

## Hook flow

- `session_start`: load config, initialize runtime, ensure bank settings when appropriate, update status.
- `context`: build recall query, fetch memories, inject an ephemeral Recall Block.
- `agent_end`: filter new transcript content, build a Retain Job, sanitize, enqueue, and attempt delivery.
- `session_shutdown`: best-effort Retain Queue flush within configured bounds.

## Scope boundaries

- Project memory uses the selected Project Bank.
- Optional user memory uses the configured User Bank.
- Tags isolate recall and retain behavior.
- Metadata records provenance but is not the filtering boundary.

## Source boundaries

Pi Hindsight owns Pi integration policy. Hindsight owns Retain, Recall, Reflect, Memory Bank behavior, bank config, mental models, directives, and API request/response behavior.

See also:

- [ADR 001](./adr/001-memory-lifecycle-and-scope/)
- [Hooks reference](/pi-hindsight/reference/hooks/)
- [Memory Banks](/pi-hindsight/concepts/memory-banks/)
