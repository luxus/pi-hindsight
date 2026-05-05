---
title: "prd.md"
---

## Product name

Pi Hindsight Extension

## Summary

Persistent memory for Pi, backed by Hindsight.

The extension gives Pi:

- automatic pre-response recall
- automatic post-response memory retention
- explicit memory tools for recall, retain, and reflect
- historical Pi session import
- project-scoped memory with optional shared/global carryover

## Problem

Pi sessions are local and durable, but they are not long-term semantic memory by themselves.

Without a dedicated memory layer:

- important project decisions are trapped in transcript history
- cross-session continuity depends on re-reading or summarization
- branch/fork history is hard to reuse semantically
- the agent does not automatically retrieve relevant context from older sessions

Hindsight solves the memory side:

- `retain` extracts facts from raw conversation/documents
- `recall` retrieves relevant memories
- `reflect` synthesizes answers from memory

The product problem is to connect Pi’s lifecycle cleanly to those capabilities.

## Goals

### Primary goals

- Remember repo-specific decisions across Pi sessions
- Preserve memory quality by following Hindsight best practices
- Keep memory injection ephemeral and transcript-safe
- Support explicit memory tools when the model or user wants them
- Make import/reimport of old Pi sessions possible

### Secondary goals

- Support an optional global/shared bank for cross-project learnings
- Expose operational diagnostics
- Make the extension a reusable foundation for future Pi extensions

## Non-goals

- Build a general MCP memory server
- Recreate the Hindsight Control Plane inside Pi
- Solve every multi-user or multi-host routing pattern in v1
- Automatically generate mental models in MVP
- Turn Pi into a multi-tenant SaaS memory hub

## Users

### Primary user

A developer using Pi for ongoing code work who wants the agent to remember:

- architecture decisions
- project conventions
- ongoing tasks
- preferences and repeated patterns
- lessons from prior debugging/refactoring sessions

### Secondary user

A power user creating multiple Pi extensions who wants:

- a clean package architecture
- reusable config/runtime patterns
- reliable AGENTS guidance for future extension work

## Core use cases

### Use case: ongoing repository memory

A user returns to the same repo after several Pi sessions.
The extension recalls relevant prior decisions before the next answer.

### Use case: explicit memory query

The agent or user wants to ask memory directly:

- “What decisions did we make about config precedence?”
- “What’s the latest understanding of this bug?”
- “Summarize what we know about the auth refactor.”

### Use case: durable write after work

At the end of a successful prompt cycle, the extension writes the structured delta to Hindsight using append mode.

### Use case: bootstrap from old sessions

A user already has Pi JSONL session history and wants to seed memory banks from it.

## Product scope

## In scope for MVP

- project-scoped bank
- optional global bank
- auto recall
- auto retain with append
- explicit tools:
  - `hindsight_recall`
  - `hindsight_retain`
  - `hindsight_reflect`
- status/doctor/import commands
- JSONL durable queue
- historical Pi session import

## Out of scope for MVP

- linked hosts / multi-server recall
- advanced bank admin UI
- auto-created mental model workflows
- collaborative/team multi-user routing
- provider-specific prompt-engineering modes beyond one safe default

## Functional requirements

### Automatic recall

- On each LLM call, the extension must be able to recall project-relevant memories
- Recall must be based on the current prompt and optional recent-turn context
- Recalled memory injection must not be persisted into the transcript
- Recall should support one or two banks:
  - project bank
  - optional global bank

### Automatic retain

- After a completed prompt lifecycle, the extension must build a structured JSON delta
- The retain write must use a stable session-linked `document_id`
- Live-session writes must default to `update_mode: "append"`
- Writes should be queueable and replayable after outages

### Explicit tools

- `hindsight_recall`
  - returns raw memory facts
- `hindsight_retain`
  - stores explicit project insights/decisions
- `hindsight_reflect`
  - asks Hindsight to synthesize an answer from memory

### Import

- Import Pi session JSONL files
- Support current-branch import
- Optionally support all-leaf import
- Support deterministic reimport without duplicates

### Diagnostics

- show whether Hindsight is reachable
- show effective config
- show active bank IDs
- show queue depth
- show import status

## Non-functional requirements

### Reliability

- No acknowledged retain job should be silently lost
- Temporary Hindsight outages must degrade to queueing, not data loss

### Safety

- Secrets and sensitive values should be redacted before retain
- Cross-project leakage should be prevented by bank strategy and strict tags

### Inspectability

- It must be easy to see:
  - which banks are used
  - when recall occurred
  - when retain occurred
  - what config source won

### Maintainability

- Package structure must support future extensions
- Runtime logic must be split by concern: config, banking, recall, retain, import, commands, tools

## Product design decisions

| Decision           | Chosen default                | Why                                             |
| ------------------ | ----------------------------- | ----------------------------------------------- |
| retain payload     | JSON conversation array       | best extraction quality                         |
| live update mode   | `append`                      | correct for growing session transcripts         |
| auto recall point  | `context` hook                | ephemeral and transcript-safe                   |
| auto retain point  | `agent_end`                   | aligns with prompt completion                   |
| bank model         | per-project + optional global | high-value default for coding workflows         |
| filtering          | tags, not metadata            | matches Hindsight visibility model              |
| explicit synthesis | `reflect` tool                | better than forcing all answers through reflect |

## User experience

### Expected default experience

1. User opens Pi in a repo
2. Extension initializes
3. On first relevant prompt, memory is recalled automatically
4. User gets an answer already informed by prior sessions
5. After the prompt completes, the session delta is retained automatically
6. If Hindsight is down, a compact retain notice indicates queueing instead of failure

### Explicit controls

Commands:

- `/hindsight:status`
- `/hindsight:doctor`
- `/hindsight:config`
- `/hindsight:import`

Tools:

- `hindsight_recall`
- `hindsight_retain`
- `hindsight_reflect`

## Success criteria

### MVP acceptance

- user can install and load the extension
- project bank is resolved deterministically
- automatic recall works before responses
- automatic retain works after responses
- append mode updates the same document across a session
- queue survives process restart
- explicit tools work
- at least one historical Pi session can be imported successfully

### Quality acceptance

- no recall block is persisted into imported transcripts
- retain payload is structured JSON, not summary text
- `context` is always set
- `document_id` is stable for the same live session
- secret redaction has tests
- queue replay has tests
- import has tests

## Release phases

### MVP

- project bank
- auto recall
- auto retain
- explicit tools
- import
- diagnostics

### Phase 2

- optional global bank merge
- richer operational filtering
- structured-output mode for `hindsight_reflect`
- repository-specific bank missions

### Phase 3

- curated mental model support
- optional approval workflows
- more advanced UX around import and diagnostics

## Metrics

### Product metrics

- recall success rate
- retain success rate
- queued job replay success rate
- import success count
- median recall latency
- median retain enqueue latency

### Quality metrics

- duplicate import rate
- redaction failure count
- cross-bank routing mistakes
- user-visible “memory used” rate on repeated sessions

## Risks

### Over-injection

Too much recalled content can crowd the prompt.
Mitigation: keep `maxTokens` conservative and tune formatting.

### Memory clutter

Retaining noisy tool chatter can reduce recall quality.
Mitigation: meaningful-only tool retention and sanitizer.

### Wrong routing

Shared-bank or weak bank derivation can cause leakage.
Mitigation: repository bank default and strict tags.

### Hidden complexity

Too many config knobs too early makes the extension hard to trust.
Mitigation: small default surface, advanced options later.

## Open questions

- Should the global bank be enabled only by explicit opt-in?
- Should imported branch summaries be kept or ignored by default?
- Which tool results are “meaningful” enough to retain automatically?
- Do we want one project bank per repo root, or a fully manual bank mapping mode in MVP?
