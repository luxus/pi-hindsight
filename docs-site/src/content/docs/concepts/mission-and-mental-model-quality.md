---
title: "Mission and mental-model quality"
---

How bank **missions** and **mental models** should look in pi-hindsight — and when the agent should **propose** create / update / refresh (never silent bank mutation).

Official Hindsight guidance: [Best practices](https://hindsight.vectorize.io/best-practices), [Mental models](https://hindsight.vectorize.io/developer/api/mental-models). Seeds: [Starter mental model suggestions](/pi-hindsight/concepts/starter-mental-model-suggestions/). Eval context: [Coding memory evaluation](/pi-hindsight/concepts/coding-memory-evaluation/).

## Hard rules (always)

- **Propose, don’t invent silently.** Create/update/refresh/delete use tools with **dry-run first** (`hindsight_mental_model`, `hindsight_bank`); user confirms via dry-run false or hub `t`.
- **Tags ⊆ retain tags.** Project models need `source:pi` + `project:<id>`; bank-global prefs: `source:pi` only. Tags not written at retain → empty refresh.
- **One dimension per mental model.** Not “everything about the user/project.”
- **Lean inject:** prefs ~600 tokens, project ~800. Fat content burns every turn.
- **Refresh:** prefer `mode: delta` + `refresh_after_consolidation` on templates; agent create may only set consolidation refresh until the TS client maps full trigger fields.
- **Missions** steer extraction/consolidation/reflect — vague missions → noisy memory (Hindsight #1 quality failure).

## Bank missions — what “good” looks like

Three strings per bank (retain / observations / reflect):

| Mission          | Job                                        | Good                                                               | Bad                                |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| **retain**       | What to extract / ignore from raw sessions | Concrete fact types + ignore list (greets, secrets, probe harness) | “Be helpful”, “extract everything” |
| **observations** | Durable patterns after retain              | Patterns, contradictions, durable only                             | Transient task state               |
| **reflect**      | Persona for synthesis                      | Domain role + grounded + opinionated when supported                | Generic chatbot                    |

### Coding bank (project)

- Retain: decisions, trade-offs, blockers, conventions, durable project prefs.
- Observations: stable architecture/process patterns; not TODOs of the day.
- Reflect: senior developer for _this_ repo.

### Coding user bank (life bank **off** / cross-project prefs)

- Retain: cross-project assistant prefs, workflows, clarification style.
- **Not** file paths, project bugs, PR noise unless it generalizes.

### Life / conversation user bank

- Retain: commitments, people/context, planning habits, communication prefs.
- **Not** repo engineering detail unless it’s truly personal durable preference.
- Reflect: personal/life-task assistant, not code reviewer.

Defaults live in `extensions/banks/bank-operations.ts` (`defaultProjectBankMissions`, `defaultGlobalBankMissions`, `defaultLifeBankMissions`).

### When to propose mission changes

Propose `hindsight_bank` `update_mission` (dry-run) when:

- Extraction is consistently wrong (too much noise / missing decisions).
- User says prefs are “wrong” or “missing” after several sessions.
- Switching coding ↔ conversation use without matching missions.

Do **not** churn missions every session.

## When optimization is worth it (signals)

Optimize only when a **repeatable problem** shows up—not because content is imperfect once.

### Mental-model signals (inspect inject + `hindsight_mental_model` list/get)

| Signal                        | What you see                                                                                                 | Likely fix                                                                                                                   | Priority                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Broken / empty content**    | Inject or get shows `"#"`, empty body, “Generating…”, or only a title                                        | `refresh`; if still empty after retain has landed, check tags ⊆ retain tags; clear+refresh if delta-drifted                  | **High** — do this session                  |
| **Wrong durable policy**      | Prefs MM contradicts the user’s stated preference (e.g. “never ask” vs wants high-signal questions)          | Explicit `hindsight_retain` of the correct pref → then refresh prefs MM; tighten `source_query` if probe noise keeps winning | **High**                                    |
| **Missing project starters**  | Active `project:<id>` has no architecture/conventions/decisions models; bank only has other projects’ models | Propose apply/create starters for **this** project (+ bank-global prefs if missing)                                          | **High** on setup / first real work in repo |
| **Inject always truncated**   | Blocks end mid-sentence; one model dominates (multi‑k chars, e.g. 8k–12k) while others starve                | Cap `max_tokens` (600–800), refresh fat model; don’t add more models                                                         | **Medium**                                  |
| **Stale after big decisions** | User finished a real architecture/product choice; MM still describes the old world                           | Wait until retain finished (next turn+); refresh `project-decisions` (and architecture if seams changed)                     | **Medium** — after the decision is retained |
| **Recurring same question**   | Every session user asks the same durable “how do we X?”                                                      | One new MM for that **single** dimension, lean max_tokens                                                                    | **Medium**                                  |
| **Cross-project bleed**       | Prefs or decisions clearly about another repo appear under this project’s inject                             | Fix tags (project vs bank-global); never “fix” by editing another project’s ids while working here                           | **High** if isolation broken                |
| **Noise as “facts”**          | Probe/bait/test harness text treated as durable prefs                                                        | Retain correction + refresh; mission ignore-list for probes; don’t import bait sessions                                      | **Medium**                                  |
| **Slightly imperfect prose**  | Wording could be nicer but policy is right                                                                   | Leave it; delta refresh after consolidation is enough                                                                        | **Low** — do not nag                        |

### Mission signals (`hindsight_bank` get + memory quality over several sessions)

| Signal                      | What you see                                                                  | Likely fix                                                             | Priority                          |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| **Noise flood**             | Recall full of greets, scheduling, tool-probe rules, one-off chat             | Tighten **retain** mission ignore-list                                 | Medium–High if multi-session      |
| **Missing decisions**       | Real architecture choices never appear in recall/MMs after real work          | Broaden retain “extract decisions/trade-offs”; keep ignore list        | Medium                            |
| **Transient as durable**    | Observations track active TODOs / “today we…” as eternal truth                | Observations mission: durable only, contradictions, not task state     | Medium                            |
| **Wrong persona**           | Reflect answers like a generic chatbot or wrong domain (coding vs life)       | Align reflect mission with bank role (coding project vs life user)     | Medium when reflect is used       |
| **Coding vs life mismatch** | Life bank extract file paths/PRs; coding bank extract pure calendar chit-chat | Use life vs global defaults (`defaultLifeBankMissions` vs coding user) | High only if life bank is enabled |

### Cadence (how often to even look)

| Cadence                                        | Action                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Session start / first work in a repo**       | Quick: expected project starters present? Prefs MM non-empty and not obviously wrong? |
| **After a major decision or multi-hour slice** | Optional: refresh decisions/architecture **after** retain has had a chance to land    |
| **User complains about memory**                | Full inspect (status, scope, list MMs, bank missions); propose a **small** patch list |
| **Not every turn**                             | No “shall I refresh mental models?” spam                                              |

### Priority order when several things look off

1. Broken/empty MM content or isolation bleed
2. Prefs contradicting the user
3. Missing starters for **this** project
4. Fat inject / truncation
5. Mission noise (only if pattern spans sessions)
6. Polish / “could be nicer”

### Cost check before proposing

Ask: will this change save **future** turns or only rephrase once?

- **Yes (optimize):** empty prefs, wrong “never ask”, 12k decisions eating inject, missing project MMs.
- **No (skip):** single awkward sentence, one stale bullet that recall already covers, speculative “maybe add 5 more models.”

## Mental models — what “good” looks like

| Field            | Good                                                                     | Bad                                  |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| **name**         | Short dimension label                                                    | Marketing fluff                      |
| **source_query** | Natural-language reflect question; “durable only”; exclude probe/one-off | Keyword dump; “summarize everything” |
| **tags**         | Subset of retain tags; project vs bank-global deliberate                 | Random tags never retained           |
| **max_tokens**   | 600–800 for seeds                                                        | Unbounded essays                     |
| **content**      | Stable background; inject preamble says not instructions                 | Session task lists, secrets          |

### Standard dimensions (coding)

| Id pattern                               | Dimension                            |
| ---------------------------------------- | ------------------------------------ |
| `coding-assistant-operating-preferences` | Bank-global agent prefs              |
| `project-architecture-and-seams--<slug>` | Where changes belong                 |
| `project-conventions--<slug>`            | Build/test/review style              |
| `project-decisions--<slug>`              | Durable product/architecture choices |

Conversation/life seeds: goals, people/context, decisions/preferences (see starter doc).

### When to propose mental-model actions

Use the **signals table above** (broken content, wrong prefs, missing starters, fat inject, post-decision refresh, recurring questions). Same tool path: dry-run create/update/refresh → user confirms.

### When **not** to propose

- Every turn “should we refresh mental models?”
- Creating models from probe/bait sessions.
- Duplicating recall (raw facts) as a mental model.
- Editing other projects’ tagged models while working in this project.
- Optimizing for polish when policy and inject budget are already fine.

## Agent workflow (copy pattern)

On user **memory complaints**, load skill `hindsight-memory-doctor` (`/skill:hindsight-memory-doctor`) — same inspect → diagnose → dry-run propose flow.

1. **Inspect:** `hindsight_status`, `hindsight_scope`, `hindsight_mental_model` list/get, `hindsight_bank` get.
2. **Diagnose** against this doc (tags, size, empty content, wrong prefs, missing project starters).
3. **Propose** in plain language: what changes, why, dry-run payload.
4. **Apply** only after user ok: `dryRun: false` on the same tool, or hub `t`.
5. **Verify:** list/get again; warn that inject list cache can lag (~`mentalModels.cacheTtlMs`).

## Anti-patterns

- Pre-summarizing before retain.
- Random `document_id`s / missing `context` on retain.
- Metadata for filtering (use tags).
- One mega mental model.
- Mission “extract all information.”
- Refreshing before new retains are available (same turn).
