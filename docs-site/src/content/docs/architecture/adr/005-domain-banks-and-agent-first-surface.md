---
title: "ADR 005: Domain banks and agent-first surface"
---

## Status

Accepted 2026-07-10 (direction). Implementation is phased via GitHub issues; defaults change only when the corresponding phase lands.

Amends:

- [ADR-001](/pi-hindsight/architecture/adr/001-memory-lifecycle-and-scope/) (scope isolation remains required; **how** isolation is achieved moves from “per-repo bank + path-hash tag” toward “domain bank + stable project tag”)
- [ADR-004](/pi-hindsight/architecture/adr/004-lifeos-dual-bank-design/) (User Bank stays opt-in; rename path toward **Life Bank**; “project bank = one bank per repo path” is no longer the long-term default)
- Resolves direction for #450 (shared/untagged observations are **opt-in**, never implicit)

## Context

Three problems stacked:

1. **Topology.** Default path-hashed Project Bank + `repo:<slug>-<pathHash>` is opaque, fragile on machine/path moves, and multiplies banks without improving mission quality.
2. **Hindsight alignment.** Official best practices treat banks as hard walls (missions, privacy) and tags as soft scope. Mental models use tags for refresh and visibility. Observation scopes must not key on volatile session tags. Multi-client MCP is per-bank.
3. **Surface.** Early TUI exposed too many edit/default/reset paths, then was cut back. Product intent: **the Pi agent does hard work** (missions, mental models, config, tags); the human gets **status + short onboarding + emergency actions**. Config remains the durable artifact on disk.

oh-my-pi’s `per-project-tagged` default is a useful sketch. We deliberately do **better**: strict project isolation by default, domain split (coding vs life), stable project identity (not basename-only), designed observation scopes, setup gate, migration, agent-first control plane, official client.

## Decision

### 1. Domain banks + project tags

| Role (config slot) | What it is                                                    | Typical Hindsight `bankId`      |
| ------------------ | ------------------------------------------------------------- | ------------------------------- |
| **Coding bank**    | Domain bank for engineering memory across repos               | e.g. `kai-coding` (user-chosen) |
| **Life bank**      | Domain bank for personal/assistant memory (evolves User Bank) | e.g. `kai-life`                 |
| **Isolated bank**  | Escape hatch: one bank dedicated to a sensitive repo          | e.g. `client-acme`              |

**Role vs bankId:** `coding` / `life` are stable Pi roles. `bankId` is the concrete Hindsight bank name and can change without renaming the role.

**Scope mode:**

| Mode                                 | Meaning                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`domain-tagged`** (target default) | One **coding** domain bank for normal repos. Soft-isolate repos with stable **`project:<id>`** tags; strict recall on that tag. Optional life bank. |
| **`isolated-bank`**                  | Hard wall: this repo uses its own bank id.                                                                                                          |

**`domain-tagged` in one sentence:** one shared coding bank for many repos; tags say which repo a memory belongs to; the bank’s mission stays “engineering.”

### 2. Project identity

Resolve `projectId` in order: config pin → normalized git remote → git root basename → cwd basename. Path-hash `repo:` is legacy detection only. Status must show tag + derivation. Strategy needs a short dedicated guide when implemented.

### 3. Where does a per-repo pin go?

`scope.projectId` chooses the **project tag inside the coding bank**, not which bank. Automatic retain goes to **coding**; life writes are explicit only.

### 4. Shared observations (#450)

**Shared observation** = consolidated under Hindsight’s **untagged/shared scope inside one bank** (cross-project prefs in the coding bank). Not cross-bank, not multi-tenant. Default recall stays strict on `project:<id>`; including shared is **explicit opt-in**. Observation scopes must not put volatile `session:` into project scopes.

### 5. Mental models (two altitudes)

| Tier        | Tags                       | Purpose                                |
| ----------- | -------------------------- | -------------------------------------- |
| Bank-global | none                       | How the user codes / collaborates      |
| Project     | `project:<id>` + id suffix | This repo’s architecture / conventions |

Inject filters by active project. Selected-bank MM tools are **core**; full control-plane catalog stays web UI.

### 6. Agent-first surface, thin TUI

API-rich for the agent; UI-thin for the human. Status is read-only with non-default tones. Agent tools cover MM, missions, config, scope for **selected** banks. Group multi-action tools and write operating-instruction descriptions so the agent knows what to call.

### 7. Setup gate (first install and upgrades)

No bank ensure / auto-recall / auto-retain until setup is satisfied. **Upgrades:** existing bank ids or prior config/runtime use migrate silently to “configured” — never force re-onboarding only because a new flag is missing. True first-run: no silent path-derived bank creation.

### 8. Status tones

Quiet = default; accent = non-default valid; warn = broken; dim = intentionally off.

## Consequences

Multi-phase implementation. ADR-004 opt-in life/user bank and no automatic user retain remain. Core-vs-companion updated for selected-bank agent tools. #450: explicit include-shared path.

## Out of scope

One mega-PR topology flip; one mega-bank for all domains; platform-wide bank admin in Pi; in-housing the Hindsight client.

## References

Hindsight best practices and 0.7–0.8.4 changelog; oh-my-pi case study; #450; ADR-001; ADR-004.
