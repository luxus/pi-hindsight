# ADR 004: lifeOS dual-bank design (project + user memory)

## Status

Accepted 2026-07-03.

## Context

Pi Hindsight already supports two kinds of memory: a per-repo **Project Bank** and an optional cross-project **User Bank** (the "lifeOS" memory — durable preferences, recurring workflows, coding habits). #420 built tag-group scope isolation specifically so recall could merge both banks safely. This ADR answers the question #424 asked: should the User Bank become a first-class default next to the Project Bank, or stay opt-in, and what should happen to the heuristic memory router along the way.

### Current state

- Dual-bank recall already works. When a repo's config enables `banks.user`, `selectMemoryScopes` returns both a project scope and a user scope; `recallForContext` queries each bank independently and merges the rendered blocks. This is exposed today as the **"Project + User"** guided-setup profile (`docs-site/src/content/docs/start/memory-profiles.md`), alongside "Project Only", "User Only", and "Recall Only".
- Automatic retain is project-only in every profile except "User Only". Even in "Project + User", the User Bank only receives writes through explicit tools (`hindsight_retain_global`) or commands — never automatically. This is a deliberate safety choice from ADR-002 ("User Bank writes require high confidence or explicit user action") and is unchanged by this ADR.
- A heuristic memory router (`extensions/operations/memory-router.ts`, `extensions/lifecycle/routing-strategy.ts`) exists to auto-classify candidate retain content as `project`/`global`/`both`/`skip` using regex keyword patterns and mission-term matching. It only auto-engages when `userRetain.mode: "router"`, which the guided-setup writer only sets for the **"User Only"** profile (no project bank to fall back to). Its own dry-run inspection tool (`hindsight_route_memory`) was already removed in the slim-surface rewrite (#417), so it now runs with no user-visible explanation of its decisions. It carries ~580 lines of implementation plus 38 parametrized eval-fixture tests.
- **Recall token budget is not split across banks.** `recallForContext` requests the full `config.recall.maxTokens` independently for every active scope. Enabling the User Bank alongside the Project Bank can silently double (or more) the memory tokens injected into every turn; nothing documents or bounds this today.
- Config migration from the legacy `global` naming (`banks.global` → `banks.user`, `globalRetain` → `userRetain`, `globalQueryPreamble` → `userQueryPreamble`) already exists and is unaffected by this ADR.

## Options considered

**(a) Dual-bank default.** Enable both banks out of the box for new setups, with merged recall and routed retain.
**(b) Opt-in User Bank with polished setup.** Keep today's model — User Bank is a deliberate choice via guided setup — and harden the gaps (budget split, router observability) rather than changing the default.
**(c) Single project bank with user-visibility tags.** Drop the separate User Bank; mark durable facts with a tag inside the project bank instead.

(c) is rejected outright: Hindsight banks are the isolation boundary, not tags. A single project bank is tied to one repo's bank ID (`deriveProjectBankId`); there is no way to recall those tagged facts while working in a _different_ repository without querying a different bank, which defeats the entire cross-project ("lifeOS") purpose. Collapsing to one bank would also regress ADR-001's invariant that project recall is repo-scoped, since "user-visible" facts would need to leak across repo tag boundaries to be found at all.

The real choice is (a) vs (b).

## Decision

**(b): keep the User Bank opt-in; harden the existing design instead of changing the default.**

This repo has a consistent, deliberate pattern of conservative defaults — `postRetainReflect` off, `userRetain.mode` explicit-only, User Bank disabled — and ADR-002 already states "Do not make User Bank automatic retain default" as a standing invariant. Defaulting the User Bank on would also mean every new install needs a second Hindsight bank configured before first use, and would silently increase the default token cost of every recall. Given Pi Hindsight's "Pi-first 1.0" scope and existing safe-by-default posture, that tradeoff is not justified today. Nothing here forecloses revisiting (a) once usage data suggests otherwise — that would be a new ADR, not a reinterpretation of this one.

**The heuristic memory router is removed.** It only ever auto-engaged in the narrow "User Only" profile, its own dry-run visibility was already deleted, and a regex/keyword classifier with no user-facing explanation is exactly the kind of unmonitorable automatic write ADR-002 warned against ("The main safety risk is silent User Bank pollution"). The issue's own framing — "whether the pattern router earns its complexity or is replaced by explicit tools/commands" — is answered: replaced. "User Only" automatic retain falls back to the same explicit-only model every other profile already uses; users write User Bank memory with `hindsight_retain_global` or a command, same as "Project + User" users do today.

## Recall merging and token budget split

Each active scope must have a bounded, independent budget so enabling the User Bank cannot silently balloon per-turn token cost. Concretely:

- `recall.maxTokens` keeps its current meaning and default (800) and continues to bound the **Project Bank** scope only. Existing project-only and project+user users see no change in Project Bank recall behavior.
- A new `recall.userMaxTokens` (default: half of `recall.maxTokens`, i.e. 400) bounds the **User Bank** scope specifically when it participates in a recall call. User memory is meant to be a smaller, durable supplement to project context, not an equal-weight second corpus.
- Both caps apply independently per bank query (as today), not as a shared pool — this keeps the change backward compatible and avoids new cross-scope coordination logic. The ceiling that changes is that User Bank recall no longer defaults to the same size as Project Bank recall.
- This is a new config field with a real default, not a documentation-only fix, so it is implementation work for a follow-up issue, not this ADR.

## Retain routing policy for personal vs. project facts

- Automatic retain stays project-bank-only in every profile. There is no automatic classifier deciding "this fact is personal, route it to the User Bank."
- Personal/durable facts reach the User Bank only through deliberate action: the `hindsight_retain_global` tool, or a future `/hindsight:retain-global`-style command if usage shows a need for one (not requested by this ADR).
- `userRetain.mode` drops the `"router"` variant. The type becomes effectively single-valued (`"explicit-only"`) going forward; keeping the field (rather than deleting it outright) preserves config-file compatibility and gives room for a future, better-specified routing strategy without another rename.
- Migration: existing configs with `userRetain.mode: "router"` (or the legacy `globalRetain.mode: "router"`) must normalize to `"explicit-only"` rather than erroring, consistent with how `enumValue()` already falls back to the default for invalid enum values today.

## Bank missions and dispositions per use case

No changes. `defaultProjectBankMissions()` and `defaultGlobalBankMissions()` (`extensions/banks/bank-operations.ts`) already give the Project Bank a repo-architecture/engineering-decision mission and the User Bank a durable-preferences/cross-project-workflow mission, and both are overridable via bank config. This split already matches "lifeOS vs coding" use cases well and needs no rework here.

## Migration for existing configs

- The existing `banks.global` → `banks.user` / `globalRetain` → `userRetain` / `globalQueryPreamble` → `userQueryPreamble` migration (`migrateUserMemoryConfigFile`) is unaffected.
- New: `userRetain.mode: "router"` (and the legacy `globalRetain.mode: "router"`) must migrate/normalize to `"explicit-only"` once the router is removed, so existing "User Only" adopters keep working without a config error, just with automatic User Bank writes disabled until they explicitly retain.

## What stays in the web UI

Unchanged from the existing 1.0 support scope (`docs/surface-reference.md`'s deferred-surfaces table): cross-bank listing, bank creation/deletion, and template management remain Hindsight control-plane responsibilities. This ADR is only about which already-selected banks participate in a given repo's recall/retain and how routing between them works — not about managing banks themselves.

## Consequences

Once the follow-up implementation issues below land:

- There will be no default behavior changes for existing Project Only, Recall Only, or Project + User users beyond the new `recall.userMaxTokens` cap applying to whichever of them already have the User Bank enabled.
- "User Only" will lose automatic classifier-driven retain; those users will need to use explicit retain (tool or future command) for User Bank writes going forward. This is a narrower, more predictable contract, consistent with every other profile.
- `extensions/operations/memory-router.ts`, `extensions/lifecycle/routing-strategy.ts`, and `tests/memory-router.test.ts` will be removed, along with the `"router"` value from `userRetain.mode`/`globalRetain.mode` and the router-eval-fixture taxonomy documented in ADR-002.
- A new `recall.userMaxTokens` config field, default value, and normalization will ship.

Effective immediately with this ADR:

- ADR-002 (explicit routing strategy seam) is superseded by this decision for the router's future; its routing-input/output shape documentation becomes historical context, not a live contract to maintain (see the amendment added to ADR-002).

## Follow-up implementation issues

Filed from this ADR's acceptance, per #424's acceptance criteria:

- Remove the heuristic memory router (`memory-router.ts`, `routing-strategy.ts`, router eval tests), drop `"router"` from the `userRetain.mode`/`globalRetain.mode` type, and add config migration/normalization so existing `"router"`-mode configs fall back to `"explicit-only"` without erroring.
- Add `recall.userMaxTokens` (default 400) and apply it to the User Bank recall scope in `recallForContext`, independent of `recall.maxTokens`.
- Update `docs-site/src/content/docs/start/memory-profiles.md`, `docs-site/src/content/docs/concepts/memory-banks.md`, and `docs/compatibility.md` to reflect the router removal and the per-bank token budget split.
- Mark ADR-002 as superseded by this ADR for the router-specific sections once the removal ships.
