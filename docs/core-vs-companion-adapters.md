# Core vs companion adapter boundary

Pi Hindsight is a Pi extension first. Its core should stay small, conservative, and directly useful inside Pi. Framework-specific integrations belong in companion packages, examples, or cookbook docs unless they are required for Pi's own memory path.

This boundary prevents scope creep while still leaving room for Hindsight patterns that help many tools.

## Core responsibilities

Core features are features that are useful inside Pi regardless of which external application frameworks exist.

Keep these in `pi-hindsight`:

- Pi extension lifecycle integration:
  - `session_start`
  - `context`
  - `agent_end`
  - `session_shutdown`
- durable automatic retain and recall for Pi sessions
- queue-first delivery, retry, dead-letter, diagnostics, and live smoke helpers
- project/global bank selection, bank derivation, and scope policy
- explicit Pi tools and commands for retain, recall, reflect, import, diagnostics, and config
- `/hindsight` TUI operations for common Pi memory workflows
- historical Pi session import
- generic seed/content import for simple formats when it stays Hindsight- and Pi-agnostic
- Hindsight bank templates when they configure memory behavior independent of any one framework
- Hindsight mental-model operations when they expose Hindsight's reusable synthesis model directly
- release, verification, and troubleshooting docs for Pi users

Core code may contain a Hindsight client adapter for Pi's runtime needs. It should not become a generic integration framework for all Hindsight consumers.

For the 1.0 line, core also includes scoped inspection and repair tools for the selected project/User Bank when those tools help Pi users debug memory behavior. Core does not imply full upstream platform-admin parity: cross-bank list/create, full-bank deletion, bank-wide stats dashboards, audit logs, and webhook administration remain deferred or non-goals unless a future issue accepts their safety and UX obligations.

## Companion and example responsibilities

Companion work is framework-specific glue. It should live outside core unless there is a strong Pi-first reason to include it.

Keep these out of `pi-hindsight` core:

- LiteLLM adapters
- CrewAI adapters
- Pydantic AI adapters
- OpenAI Agents adapters
- Vercel AI SDK / Chat adapters
- app-specific prompt assembly middleware
- framework-specific request/response serializers
- framework-specific package scaffolds, deployment templates, or CLI wrappers

Good homes for this work:

- separate companion packages, such as `pi-hindsight-litellm` or `hindsight-vercel-ai-example`
- examples under a future companion/example repository
- cookbook docs that link to external reference implementations
- short migration notes that explain how to map Hindsight concepts without adding runtime code here

## Decision test for new work

Use this test before adding a feature to core:

1. Does this directly improve Pi's memory lifecycle, TUI, tools, commands, import, diagnostics, or release safety?
2. Does it use official Hindsight APIs without inventing undocumented request shapes?
3. Is it independent of one application framework's middleware, serializer, or deployment model?
4. Can it be tested in this repository without pulling in unrelated framework dependencies?
5. Would removing the target external framework still leave the feature useful to Pi users?

If most answers are yes, it can be core. If any answer depends on a non-Pi framework, prefer companion or example work.

## Examples

| Request                                                                   | Location        | Reason                                                              |
| ------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| Add `/hindsight` read-only mental model list/detail view                  | Core            | Pi can inspect Hindsight mental models without cloning web UI.      |
| Add operation-service seam for creating Hindsight bank templates          | Core            | Bank templates are Hindsight-native and framework-neutral.          |
| Import Markdown, text, or JSON seed files into a selected bank            | Core if generic | Simple content import helps Pi projects without framework coupling. |
| Add LiteLLM middleware that injects recalled memory into chat completions | Companion       | Middleware shape belongs to LiteLLM, not Pi.                        |
| Add Vercel AI SDK route handler example                                   | Example         | Useful pattern, but framework-specific runtime and deployment.      |
| Add CrewAI memory bridge                                                  | Companion       | Agent framework integration should not expand core dependencies.    |

## Documentation rule

README should stay short. It may state that Pi Hindsight is Pi-first and link here. Detailed boundaries, examples, and future adapter ideas belong in this document or companion docs.
