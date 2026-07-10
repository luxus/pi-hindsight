# ADR 005: Domain banks, project tags, and agent-first surface

## Status

Accepted 2026-07-10 (direction). Implementation is phased via GitHub issues; defaults change only when the corresponding phase lands.

Amends:

- ADR-001 (scope: project isolation remains required; **how** isolation is achieved moves from “per-repo bank + path-hash tag” toward “domain bank + stable project tag”)
- ADR-004 (User Bank stays opt-in; rename path toward **Life Bank**; “project bank = one bank per repo path” is no longer the long-term default)
- Resolves direction for #450 (shared/untagged observations are **opt-in**, never implicit)

Supersedes the temporary handoff note on mental-model tools + tag opacity (content moved to issues).

## Context

Three problems stacked:

1. **Topology.** Default path-hashed Project Bank + `repo:<slug>-<pathHash>` is opaque, fragile on machine/path moves, and multiplies banks without improving mission quality.
2. **Hindsight alignment.** Official best practices treat banks as hard walls (missions, privacy) and tags as soft scope. Mental models use tags for refresh and visibility. Observation scopes must not key on volatile session tags. Multi-client MCP is per-bank.
3. **Surface.** Early TUI exposed too many edit/default/reset paths, then was cut back. Kai’s product intent: **the Pi agent does hard work** (missions, mental models, config, tags); the human gets **status + short onboarding + emergency actions**. Config remains the durable artifact on disk.

oh-my-pi’s `per-project-tagged` default is a useful sketch (shared bank + project tags + two-tier MMs). We deliberately do **better**: strict project isolation by default, domain split (coding vs life), stable project identity (not basename-only), designed observation scopes, setup gate, migration, agent-first control plane, official client.

## Decision

### 1. Domain banks + project tags (target topology)

| Role (config slot) | What it is                                                    | Typical Hindsight `bankId`      |
| ------------------ | ------------------------------------------------------------- | ------------------------------- |
| **Coding bank**    | Domain bank for engineering memory across repos               | e.g. `kai-coding` (user-chosen) |
| **Life bank**      | Domain bank for personal/assistant memory (evolves User Bank) | e.g. `kai-life`                 |
| **Isolated bank**  | Escape hatch: one bank dedicated to a sensitive repo          | e.g. `client-acme`              |

**Role vs bankId (review clarification):**

- `coding` / `life` are **stable role identifiers** in Pi config and tools (aliases), like today’s `project` / `global`.
- `bankId` is the **concrete Hindsight bank name** and can change without renaming the role.
- Example: `banks.coding.bankId = "kai-coding-v2"` still uses the **coding** slot for automatic project retain/recall; only the server-side bank string changes.

**Scope mode:**

| Mode                                 | Meaning                                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`domain-tagged`** (target default) | Use the **coding** domain bank for all normal repos. Soft-isolate repos with a stable **`project:<id>`** tag on retain and **strict** recall filter on that tag. Optional life bank for cross-cutting personal memory. |
| **`isolated-bank`**                  | Hard wall: this repo uses its own bank id (legacy-like privacy). Project tags optional inside that bank.                                                                                                               |

**`domain-tagged` in one sentence:** one shared coding bank for many repos; tags say which repo a memory belongs to; the bank’s mission stays “engineering.”

### 2. Project identity (not path hash)

Resolve `projectId` in order:

1. Explicit pin (`scope.projectId` in project or global config)
2. Normalized git remote (when present)
3. Git root basename
4. Cwd basename fallback

Path-hash `repo:` remains only for **legacy detection / migration**, not new writes.

**Documentation requirement:** `projectIdStrategy` and pin behavior need a dedicated short guide (not only a config field name). Humans and agents must see derivation in status (“`project:finalform` from pin” / “from remote `github.com/…`”).

### 3. Where does a per-repo pin go? (review clarification)

Per-repo `.pi/hindsight.json` fields such as `scope.projectId` **do not choose the life bank**. Routing:

| Write path                        | Bank role                                     | Tags                                     |
| --------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Automatic retain (coding profile) | **coding**                                    | `project:<id>`, `source:pi`, `session:…` |
| Explicit project retain           | **coding** (or isolated bank if mode says so) | same                                     |
| Explicit life / user retain       | **life**                                      | no project tag required; `source:pi`     |
| Automatic life retain             | **never** (ADR-004 invariant stands)          | —                                        |

So `scope.projectId` answers: **which project tag inside the coding bank**, not “which bank.” Bank selection is profile + `banks.coding` / `banks.life` / isolated mode.

### 4. Shared observations (review clarification + #450)

**Shared observation** means an observation consolidated under Hindsight’s **untagged / global observation scope** inside **one bank** — typically so cross-project coding preferences can form beliefs that are **not** tied to a single `project:` tag.

It does **not** mean:

- shared across different Hindsight banks
- shared across users/tenants
- automatic leakage of project A’s facts into project B’s strict recall

Default recall stays **`any_strict` on `project:<id>`**. Reaching shared/untagged observations requires **explicit opt-in** (config or tool flag), composed as an additional filter path (exact empty tags / documented Hindsight pattern). This is the #450 decision: **(a)-style explicit include**, not silent OR, not “shared is unreachable forever.”

Observation scopes on retain must **not** put volatile `session:` into the project observation scope (session tags fragment consolidation). Prefer scopes like `[["project:{projectId}"]]` plus optional `"shared"`.

### 5. Mental models (two altitudes)

Inside the coding bank:

| Tier        | Tags on model                     | Purpose                                            |
| ----------- | --------------------------------- | -------------------------------------------------- |
| Bank-global | none (or non-project only)        | How the user codes / collaborates                  |
| Project     | `project:<id>` + stable id suffix | This repo’s architecture / conventions / decisions |

Inject must filter: bank-global ∪ models matching active project tag.  
Refresh tags must be a subset of retain tags (Hindsight `all_strict` footgun).

Selected-bank mental-model **tools are core**. Full control-plane catalog browsing stays web UI.

### 6. Agent-first surface, thin TUI

**Principle:** API-rich for the agent; UI-thin for the human; config is the durable artifact the agent maintains.

| Human                                 | Agent                                              |
| ------------------------------------- | -------------------------------------------------- |
| Status (read-only, non-default tones) | Status tool (same fields)                          |
| Short guided onboarding               | Setup / config patch tools                         |
| Mode, next-opt-out, flush, doctor     | Full control plane tools for **selected** banks    |
| No edit/default/reset farm            | MM CRUD, mission edit, scope info, migrate dry-run |

**Agent discoverability (review fear):** rich tools only help if the agent knows they exist. Mitigations required in implementation issues:

1. Prefer **grouped multi-action tools** with one clear name (`hindsight_mental_model` + `action`, `hindsight_config` + `action`) over a dozen similarly named tools when possible.
2. Tool descriptions written as **operating instructions** (when to use, which bank role, safety), not one-line stubs.
3. Generated surface reference + tools-and-commands docs stay truthful.
4. Optional later: a short ephemeral “memory ops available” line in status/doctor only — not a second settings UI.
5. Do **not** rely on TUI to teach the agent.

Thin TUI is intentional; many extensions have no TUI. Status + onboarding + emergencies are enough for humans.

### 7. Setup gate (first install **and** upgrades)

**No bank ensure, auto-retain, or auto-recall network I/O until setup is satisfied.**

Setup is satisfied when config clearly selects banks/mode, including:

**New installs:** guided setup or agent setup tool writes bank ids + scope mode + `setupComplete` (or equivalent predicate).

**Upgrades from older versions (review clarification):** treat as already set up when any of:

- explicit `banks.project.bankId` / `banks.coding.bankId` / user-life bank id present
- project/global config files already exist with bank/enable settings from prior pi-hindsight versions
- durable local runtime state that only appears after real use (e.g. retain cursor / queue files) **together with** enabled project bank — normalize by writing `setupComplete: true` (or the equivalent flag) on first load so users are not forced through onboarding again

Never force re-onboarding on upgrade solely because the new flag is missing. Prefer **silent migration to “configured”** for existing adopters; show status tones for “legacy path-hash identity — consider migrate” rather than blocking memory.

Until configured (true first-run only): status says setup required; tools that need a bank return a clear setup error; **no silent path-derived bank creation**.

### 8. Status tones

Status is the primary human dashboard: banks, project tag + derivation, missions present, MM counts, queue, reachability. Compare to defaults:

- quiet = default for profile
- accent = non-default but valid
- warn = broken / setup incomplete / scope mismatch
- dim = intentionally disabled

Read-only; changes go through agent tools or guided setup.

## Consequences

- Implementation is multi-phase (setup gate → stable projectId → domain default → agent tools → MM inject filter → shared recall → migrate). Do not ship a silent topology flip without migration docs.
- ADR-004’s “User Bank opt-in / no automatic user retain” remains. Life Bank is the user-facing name; aliases stay during transition.
- Core-vs-companion: selected-bank MM/mission/config tools move to **core**; platform-wide admin stays web.
- #450: implement explicit include-shared path; document that shared ≠ cross-bank.
- Tests must cover: setup gate, upgrade migration, projectId stability, MM inject isolation, no ensure without setup.

## Out of scope for this ADR

- Implementing all phases in one PR
- One mega-bank for code + life + medical
- Platform-wide bank list/delete in Pi
- In-housing the Hindsight client

## Follow-up issues

Filed from this ADR (titles may be adjusted):

1. Setup gate + upgrade migration + short onboarding
2. Status fields with non-default tones
3. Stable projectId + doctor scope diagnostics
4. Domain coding bank default + profiles
5. Agent tools (config, bank mission, mental models, scope)
6. Slim TUI hub
7. MM inject filter + template project tags
8. includeSharedObservations (#450 implementation)
9. Scope migrate dry-run / dual-tag
10. MCP multi-client docs

## References

- Hindsight best practices (banks, tags, missions, MM tag strategy)
- Hindsight 0.7–0.8.4 changelog (observation scopes, shared, exact untagged, export/import, MM stale/cron)
- oh-my-pi Hindsight case study (inspiration, not ceiling)
- #450, ADR-001, ADR-004
