---
title: "Hooks reference"
---

Pi Hindsight uses documented Pi extension lifecycle hooks. This page is a reference for what each hook path owns.

For the conceptual behavior behind Retain, Recall, and queue durability, see:

- [Retain, Recall, and Reflect](/pi-hindsight/concepts/retain-recall-reflect/)
- [Retain Queue durability](/pi-hindsight/concepts/queue-durability/)

## `session_start`

Initializes runtime memory state.

Responsibilities:

- load and normalize config
- initialize Hindsight client/runtime state
- ensure configured banks where appropriate
- check append capability/status
- update setup/status facts

## `context`

Runs automatic Recall before answer generation.

Responsibilities:

- select project and optional user/global memory scopes
- compose a fresh recall query from recent conversation context
- fetch Hindsight memory candidates
- format an ephemeral Recall Block
- inject that block into provider context

Recall Blocks must not be persisted into Pi transcript history or retained back into Hindsight.

## `agent_end`

Runs automatic Retain after a turn.

Responsibilities:

- respect config and session memory mode gates
- filter already-retained transcript content using the Retain Cursor
- project transcript messages into structured source content
- sanitize sensitive data where possible
- build a Retain Job with bank ID, Document ID, tags, metadata, and update mode
- enqueue before delivery
- attempt bounded delivery/flush

## `session_shutdown`

Performs best-effort queue flushing.

Responsibilities:

- flush queued Retain Jobs within configured shutdown bounds
- leave undelivered jobs on disk for later retry

Shutdown must not silently discard queued memory.

## Tool and command registration

Tools and commands are registered through the Operation Catalog and delegate to the Memory Operation Service. This keeps explicit user intents shared across tools, commands, setup flows, diagnostics, and smoke helpers.

See [Tools and commands](/pi-hindsight/reference/tools-and-commands/) and [Generated surface reference](/pi-hindsight/reference/surface-reference/) for the exact public surface.
