# pi-hindsight Context

## Purpose

`pi-hindsight` is a Pi extension that gives Pi durable long-term memory through Hindsight while keeping project memory isolated, recall ephemeral, and writes inspectable. The extension is designed around explicit memory boundaries: what is recalled into a turn, what is retained after a turn, what is queued for durability, and what is imported from historical sessions.

Use this glossary when naming issues, tests, refactors, commands, and user-facing documentation. Prefer these terms over synonyms so agents and maintainers describe the same system in the same language.

## Load-bearing terms

### Hindsight

The external memory service that stores banks, extracts observations, recalls relevant memory candidates, and reflects over stored memory. Hindsight API behavior is the source of truth for request shapes and supported fields.

### Memory Bank

An isolated Hindsight namespace. Banks are the primary boundary between unrelated memory. `pi-hindsight` normally uses one Project Bank per repository and optionally one explicitly configured User Bank.

### Project Bank

The bank selected for the current repository. It stores repo-specific architecture, decisions, bugs, tasks, import history, and operational context. Project recall is scoped with repository tags so memory from other repositories does not leak in.

### User Bank

An optional shared bank for durable user-level preferences, recurring workflows, and cross-project habits. It is disabled unless explicitly configured. Automatic retain never writes to the User Bank; User Bank writes are always explicit, through a tool or command. Legacy config/tool aliases may still call this bank `global`.

### Bank Alias

A stable name that resolves to a real bank ID. `project` means the selected Project Bank. `global` is the legacy/internal alias for the configured User Bank. Prefer **User Bank** in user-facing docs when the exact bank ID is not important.

### Bank Template

A Hindsight manifest (bank config overrides, mental models, directives) that provisions a bank in one call. `pi-hindsight` bundles use-profile-aware built-in templates (coding vs conversation) applied from the `/hindsight` hub (`t`) or guided setup, targeted at Project Bank and User Bank missions; browsing, editing, and exporting arbitrary templates remains a Hindsight control-plane responsibility.

### Agent Use

Config `agentUse`: `coding` (default) or `conversation`. Selects which starter mental-model sets apply so coding agents and conversation/real-life agents do not share the same seed queries.

### Mental Model

A Hindsight-synthesized, reusable answer to a recurring question over stored memory, refreshed via Reflect rather than recalled raw. Ad hoc mental model creation, editing, or refresh stays in the Hindsight control-plane web UI. Bundled bank templates are the dry-run-gated path to seed starter models. When models have content and `mentalModels.inject` is enabled, their content is injected ephemerally into automatic context alongside recall (not retained).

### Retain

A write to Hindsight. Retain stores raw rich content, not summaries. Automatic retain writes structured session deltas after turns; explicit retain writes user-provided content through tools or commands.

### Automatic Retain

The `agent_end` hook path that retains new transcript content after a turn. It is gated by config and session memory mode, uses the Retain Cursor to avoid duplicate writes, sanitizes content, builds a Retain Job, enqueues it, then tries delivery.

### Explicit Retain

A user-triggered retain operation through a tool or command. Explicit retains are queue-first like automatic retains, but they use user-provided content and context. Explicit retains can target the Project Bank or User Bank by alias.

### Retain Job

The durable unit queued before delivery to Hindsight. It contains bank ID, document ID, content, context, tags, metadata, entities, update mode, and provenance needed to retry without recomputing policy.

### Retain Queue

The JSONL-backed durability layer for Retain Jobs. Jobs are written before network delivery so Hindsight outages do not lose memory. Queue behavior must stay safe under malformed lines, dead-letter rollover, and concurrent Pi processes.

### Queue Lock

The filesystem lock that protects queue rewrites across Pi processes. It is intentionally visible and stale-lock aware because queue corruption is a memory durability failure.

### Dead Letter Queue

The queue destination for jobs that cannot be delivered after retry policy is exhausted or cannot be represented safely in the active queue. Dead-letter state should be inspectable and never silently discarded.

### Retain Cursor

The persisted marker for the last retained transcript boundary in a live session. It prevents automatic retain from writing the same messages repeatedly across turns or extension restarts.

### Document ID

The stable Hindsight document identifier for retained content. Live sessions use stable append-oriented document IDs. Historical imports use deterministic document IDs so reimports are idempotent. Exact document IDs are required for deletion.

### Update Mode

The Hindsight write behavior for a document. `append` is used for ongoing live sessions and queue retries. `replace` is used for deterministic historical reimports or explicit one-shot documents where replacement is intended.

### Append Capability Probe

Startup/runtime detection that confirms whether the configured Hindsight path supports append-style retain behavior. The result affects status and diagnostics; it should not silently rewrite memory policy.

### Recall

A read from Hindsight that retrieves memory candidates before answer generation. Recall is not synthesis and not persistence. Automatic recall injects an ephemeral memory block into the provider context, then the block is excluded from retained transcript content.

### Recall Block

The formatted ephemeral memory context injected into a turn. It includes recalled memory candidates and source bank labels. Recall Blocks must not be persisted into Pi transcript history or retained back into Hindsight.

### Last-Recall Snapshot

An opt-in local sidecar file for debugging recall behavior. When enabled, it records the latest recall query, results, rendered block, and optionally redacted recall failures. It is visibility-only and not provider cache.

### Reflect

An explicit Hindsight operation for synthesis and reasoning over memory. Reflect is for questions that need analysis across stored memory. Automatic memory behavior should not route every turn through Reflect.

### Observation

A Hindsight-extracted fact, event, entity, relationship, or pattern derived from retained content. Observation settings and scopes affect what Hindsight can infer from retained evidence.

### Observation Scope

A configured scope passed with retain jobs so Hindsight observations are isolated by harness, repository, and other policy boundaries. Scopes must be expanded before queueing so retries preserve the policy active when the job was created.

### Import

The historical session ingestion path. Import parses Pi JSONL sessions, selects branches, builds deterministic import documents, queues retain jobs, records checkpoints/manifests, and can run as a dry-run preview before writing.

### Durable Signal

Raw source evidence worth keeping in memory because it records a fact, decision, task, bug, error, verification result, issue/PR/commit reference, blocker, follow-up, or project workflow outcome.

### Import Noise

Transcript material that should not become durable source truth by default, such as streaming UI records, process/status chatter, repeated successful command output, large file reads, and other replay artifacts.

### Tool Evidence

Tool output that carries memory value. Failed tool results are usually durable evidence when kept concise. Large successful tool output is usually import noise unless a strict policy explicitly keeps a small low-noise summary.

### Workflow Signal

Durable Signal about project execution: selected issues, branches, PRs, commits, review decisions, CI and smoke verification, release gates, blockers, and follow-up work.

### Recall Contamination

Persisting a Recall Block, Last-Recall Snapshot, or other previously injected memory back into Hindsight as if it were new source evidence. Recall contamination must be prevented in live retain and historical import.

### Import Manifest

The durable record of historical import work that has been planned or completed. It makes imports inspectable, resumable, and idempotent across repeated runs.

### Import Checkpoint

The per-import progress record for queued, completed, skipped, or failed import documents. Checkpoints make reimport behavior visible and help resume after outage or interruption.

### Session Memory Mode

Per-session control over recall and retain behavior. Modes such as normal, read-only, ignored, and next-turn opt-out gate automatic memory behavior without changing global configuration.

### Next Opt-Out

A one-turn session flag that skips automatic retain for the next completed turn while preserving future memory behavior. It is stronger than default retain but weaker than ignored/read-only session modes where applicable.

### Memory Operation Service

The shared service behind tools, commands, setup flows, and smoke tests. It owns user intents such as recall, retain, reflect, flush, delete, route, config, and import so adapters do not duplicate behavior.

### Operation Catalog

The single catalog that registers public tools and commands. It maps Pi-facing surfaces to Memory Operation Service calls and keeps schemas/presenters centralized.

### Redaction

The safety layer that removes or masks secrets before retain, diagnostics, or debug sidecars. Tokens, API keys, cookies, bearer headers, private URLs, and known secret-like values must not be logged or retained in normal mode.

## Naming rules

- Use **Project Bank** and **User Bank** when talking about bank policy. Use `global` only for exact legacy config/tool aliases.
- Use **Retain**, **Recall**, and **Reflect** for the three Hindsight operations; do not collapse them into a generic “memory call.”
- Use **Retain Queue**, **Retain Job**, **Queue Lock**, and **Dead Letter Queue** for durability behavior.
- Use **Import Manifest** and **Import Checkpoint** for historical import state.
- Use **Last-Recall Snapshot** for local recall debugging sidecars; do not call it cache.
- Use **Recall Block** for ephemeral injected context; do not call it transcript memory.
- Use **Memory Operation Service** for shared intent logic; use **Operation Catalog** for registration.

## Architectural boundaries

- `extensions/index.ts` should stay thin and only wire Pi hooks, commands, and tools.
- `memory-lifecycle.ts` owns turn-level hook orchestration; focused lifecycle policy modules own recall/retain details.
- `memory-operation-service.ts` and operation modules own explicit user intents shared by tools, commands, setup, and smoke tests.
- `client.ts` and `client-rest.ts` are the Hindsight Adapter seam; callers should not invent request shapes.
- Queue modules own durability mechanics; lifecycle and operations should not rewrite queue files directly.
- Import modules own historical session parsing, branch selection, planning, checkpointing, and delivery orchestration.
- Config modules must keep parsing, normalization, writing, and TUI field metadata narrow and deterministic.

## Invariants

- Recall happens before answer generation and remains ephemeral.
- Retain writes raw rich content, not summaries.
- Live session retains use stable document IDs and `append` mode.
- Historical imports use deterministic document IDs and `replace` mode where reimport idempotency requires it.
- Project memory is the default; User Bank memory requires explicit configuration, and automatic retain never writes to the User Bank. User Bank writes are always explicit (tool or command).
- Tags define scope and visibility; metadata records provenance and links back to source records.
- Queue-first durability applies to automatic retain, explicit retain, and imports.
- Debug visibility must be opt-in and must redact secrets before persistence.
