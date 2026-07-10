# pi-hindsight Context

## Purpose

`pi-hindsight` is a Pi extension that gives Pi durable long-term memory through Hindsight while keeping project memory isolated, recall ephemeral, and writes inspectable. The extension is designed around explicit memory boundaries: what is recalled into a turn, what is retained after a turn, what is queued for durability, and what is imported from historical sessions.

Use this glossary when naming issues, tests, refactors, commands, and user-facing documentation. Prefer these terms over synonyms so agents and maintainers describe the same system in the same language.

## Load-bearing terms

### Hindsight

The external memory service that stores banks, extracts observations, recalls relevant memory candidates, and reflects over stored memory. Hindsight API behavior is the source of truth for request shapes and supported fields.

### Memory Bank

An isolated Hindsight namespace. Banks are the primary boundary between unrelated memory. They own missions, dispositions, and mental-model catalogs. Prefer **few domain banks** (coding, life) rather than one bank per folder path. See ADR-005.

### Domain Bank

A bank chosen by **role** (coding or life), not by absolute path. Many repositories can share the coding domain bank and separate their memories with project tags.

### Coding Bank

The domain bank role for engineering memory (architecture, decisions, bugs, conventions). Config slot stays `coding` (or legacy `project`) even when the concrete `bankId` string changes (e.g. `kai-coding` → `kai-coding-v2`).

### Life Bank

The domain bank role for durable personal/assistant memory (preferences, workflows, cross-surface chat). Evolves the **User Bank** concept. Automatic retain never writes here; writes are always explicit. Legacy aliases: `user`, `global`.

### Project Bank

**Legacy / transition term** for “the bank selected for this repository.” Under ADR-005 **domain-tagged** mode this is usually the **Coding Bank** plus a `project:` tag, not a unique bank per path. Under **isolated-bank** mode it is a dedicated hard-wall bank for one repo.

### User Bank

Legacy name for the **Life Bank**. Still used in older docs and config. Prefer **Life Bank** in new user-facing docs. Automatic retain never writes to the User/Life Bank; writes are always explicit. Legacy config/tool aliases may still say `global`.

### Bank Alias / Role

A stable Pi name that resolves to a real Hindsight `bankId`. Roles: `coding` (and legacy `project`), `life` (and legacy `user` / `global`). Changing `bankId` does not rename the role.

### Scope Mode

How project isolation is achieved. **`domain-tagged`**: one coding domain bank + strict `project:<id>` tags. **`isolated-bank`**: dedicated bank for this repo (hard privacy).

### Project ID / Project Tag

Stable project identity used as tag `project:<id>`. Resolution order: config pin → git remote → basename. Not absolute-path hash. Status must show the active tag and how it was derived.

### Shared Observation

An observation consolidated in the **untagged / shared scope inside one bank** (Hindsight observation scopes), so cross-project beliefs in that bank can form without a project tag. Not cross-bank and not multi-tenant sharing. Default project recall stays strict; including shared observations is **opt-in** (#450 / ADR-005).

### Bank Template

A Hindsight manifest (bank config overrides, mental models, directives) that provisions a bank in one call. `pi-hindsight` bundles use-profile-aware built-in templates (coding vs conversation) applied from the `/hindsight` hub (`t`) or guided setup, targeted at Project Bank and User Bank missions; browsing, editing, and exporting arbitrary templates remains a Hindsight control-plane responsibility.

### Agent Use

Config `agentUse`: `coding` (default) or `conversation`. Selects which starter mental-model sets apply so coding agents and conversation/real-life agents do not share the same seed queries.

### Mental Model

A Hindsight-synthesized, reusable answer to a recurring question over stored memory, refreshed via Reflect rather than recalled raw. Two altitudes under domain banks: **bank-global** (no project tag; e.g. coding preferences) and **project-tagged** (this repo’s architecture/conventions). Tags on a model gate refresh inputs and visibility. **Agent tools** for list/create/update/refresh on selected banks are core (ADR-005); full control-plane browsing stays web UI. Bundled templates may seed starters. When inject is enabled, content is ephemeral in context (not retained).

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

A configured scope passed with retain jobs so Hindsight observations are isolated by harness, repository, and other policy boundaries. Scopes must be expanded before queueing so retries preserve the policy active when the job was created. Prefer stable scopes such as `project:<id>`; do not put volatile `session:` tags into observation project scopes. Optional **shared** scope builds untagged bank-level observations (see Shared Observation).

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

### Setup Gate

Memory network I/O (ensure bank, auto-recall, auto-retain) runs only after setup is satisfied: explicit bank ids / completed onboarding, or **upgrade migration** that recognizes an existing install. First run must not silently create a path-derived bank.

### Agent-First Surface

Day-to-day memory control (missions, mental models, config patches, scope inspect) is done by **model-facing tools**. The TUI stays thin: status, onboarding, emergencies. Config files remain the durable source of truth the agent writes.

## Naming rules

- Prefer **Coding Bank** / **Life Bank** and roles `coding` / `life` in new docs. **Project Bank** / **User Bank** / `global` remain valid transition and legacy terms.
- Use **domain-tagged** and **isolated-bank** for scope mode; do not say “one bank per folder” as the default goal.
- Use **project tag** / **project id**, not opaque path hashes, when describing new identity.
- Use **Shared Observation** only for untagged-within-bank consolidation; say so explicitly.
- Use **Retain**, **Recall**, and **Reflect** for the three Hindsight operations; do not collapse them into a generic “memory call.”
- Use **Retain Queue**, **Retain Job**, **Queue Lock**, and **Dead Letter Queue** for durability behavior.
- Use **Import Manifest** and **Import Checkpoint** for historical import state.
- Use **Last-Recall Snapshot** for local recall debugging sidecars; do not call it cache.
- Use **Recall Block** for ephemeral injected context; do not call it transcript memory.
- Use **Memory Operation Service** for shared intent logic; use **Operation Catalog** for registration.
- Use **Setup Gate** and **Agent-First Surface** when discussing onboarding and tools vs TUI.

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
- Project/coding memory is the default automatic path; Life/User Bank requires explicit configuration, and automatic retain never writes there. Life/User writes are always explicit (tool or command).
- Tags define scope and visibility; metadata records provenance and links back to source records.
- Setup gate: no silent bank ensure before configuration (with upgrade migration for existing installs).
- Agent-first: control-plane changes prefer tools over TUI field farms (ADR-005).
- Queue-first durability applies to automatic retain, explicit retain, and imports.
- Debug visibility must be opt-in and must redact secrets before persistence.
