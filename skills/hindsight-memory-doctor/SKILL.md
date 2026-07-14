---
name: hindsight-memory-doctor
description: >
  Self-check Pi Hindsight memory when the user is frustrated, confused, or
  complains about memory quality (wrong prefs, missing context, "it forgot",
  "never ask questions" vs wants questions, empty inject, wrong project).
  Inspect status/scope/mental models/bank missions, compare to quality docs,
  propose dry-run fixes. Trigger on memory complaints, "memory is wrong",
  "forgot", "why did it inject", /hindsight-memory-doctor, or conflict with
  recalled/MM content. Do NOT run every turn.
---

# Hindsight memory doctor

When the user is **upset or skeptical about memory**, behave like a careful human under conflict: **stop, inspect, question the memory stack**, then propose a small fix. Do not argue from broken inject. Do not mutate banks silently.

Authoritative criteria: `docs/mission-and-mental-model-quality.md` (packaged; also docs-site _Mission and mental-model quality_).

## Trigger (yes)

- User complains about memory / Hindsight / inject / prefs / “forgot” / wrong project context
- Injected MM or recall **contradicts** the user (e.g. “do not ask questions” vs wants high-signal questions)
- User asks why memory looks wrong or empty
- Explicit `/skill:hindsight-memory-doctor`

## Do not trigger

- Normal coding with healthy inject
- Single imperfect recall hit
- Every turn “maybe refresh?”

## Workflow (always)

1. **Acknowledge** the complaint in one line. Treat it as a possible **system** issue, not only user error.
2. **Inspect** (tools; no dry-run needed for reads):
   - `hindsight_status`
   - `hindsight_scope`
   - `hindsight_mental_model` action=list (coding bank; life/user if enabled)
   - `hindsight_mental_model` action=get for broken/suspicious ids
   - `hindsight_bank` action=get for coding (and life if enabled) — missions
3. **Score against the quality guide** (priority order):
   1. Broken/empty MM content (`#`, empty, Generating…) — prefs MMs may need `fact_types` world+experience+observation, not observation-only
   2. Prefs contradict the user
   3. Missing starters for **this** `project:<id>`
   4. Fat inject / truncation
   5. Mission noise (only if multi-session pattern)
   6. Polish-only → skip
4. **Propose** a short plan (max 3 actions). Prefer:
   - explicit retain of the **correct** durable fact
   - refresh (or clear+refresh if delta-drift)
   - create missing starters for this project
   - mission patch only if extraction is systematically wrong
5. **Dry-run first** for any mutation (`hindsight_mental_model` / `hindsight_bank` dryRun true). Apply only after user ok (`dryRun: false` or hub).
6. **Verify** list/get again. Note inject cache may lag (`mentalModels.cacheTtlMs`, often ~5 min) — new session or wait.

## Output shape

```text
Memory doctor
- What I checked: …
- What’s wrong (priority): …
- Proposed fixes (dry-run): …
- Not doing: … (noise / other projects / silent rewrite)
```

## Hard rules

- Never silent create/update/delete of mental models or missions.
- Never edit another project’s `project:<other>` models to “fix” this session.
- Same-turn retain + rely-on-recall is invalid; refresh after retain has landed.
- If tools unavailable / setup incomplete: say so and point to `/hindsight` setup.

## Optional user invoke

`/skill:hindsight-memory-doctor` — run full workflow once.
