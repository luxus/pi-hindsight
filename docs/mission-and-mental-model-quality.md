# Mission and mental-model quality (agent guide)

How bank **missions** and **mental models** should look in pi-hindsight — and when the agent should **propose** create / update / refresh (never silent bank mutation).

Official Hindsight guidance: [Best practices](https://hindsight.vectorize.io/best-practices), [Mental models](https://hindsight.vectorize.io/developer/api/mental-models). Seeds: [Starter mental model suggestions](starter-mental-model-suggestions.md). Eval context: [Coding memory evaluation](coding-memory-evaluation.md).

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

| Signal                                                                                   | Proposal                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Missing expected starter for active project (domain-tagged bank has other projects only) | Create/apply starters for **this** `project:<id>` + bank-global prefs if missing   |
| Inject shows empty / “Generating…” / useless “#”                                         | Refresh (or clear+refresh if delta-drifted)                                        |
| Prefs contradict user (e.g. “never ask questions” vs user wants high-signal questions)   | Explicit retain of correct pref + refresh prefs MM; tighten source_query if needed |
| Content bloated / always truncated in inject                                             | Lower `max_tokens`, refresh; avoid adding more models                              |
| Same question every session, no MM                                                       | Propose **one** new model for that dimension only                                  |
| User finished a major architecture decision                                              | Refresh `project-decisions` after retain has landed (not same turn as retain)      |

### When **not** to propose

- Every turn “should we refresh mental models?”
- Creating models from probe/bait sessions.
- Duplicating recall (raw facts) as a mental model.
- Editing other projects’ tagged models while working in this project.

## Agent workflow (copy pattern)

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
