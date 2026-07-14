---
title: "Starter mental model suggestions"
---

Mental models are a **core** Hindsight feature. Pi Hindsight provisions them through use-profile-aware bank templates (guided setup or `/hindsight` → `t`), then injects non-empty model content into automatic context.

## Placement decision

Starter suggestions live here and in `extensions/banks/bank-templates.ts` (keep in sync). Applying a bundled template creates these models via Hindsight's bank-template import endpoint — dry-run gated, confirm before write. Arbitrary mental-model authoring remains in the Hindsight control-plane web UI.

For quality criteria and when agents should **propose** create/update/refresh (never silent), see [Mission and mental-model quality](/pi-hindsight/concepts/mission-and-mental-model-quality/).

## Product rules

- Suggestions are explicit opt-in (setup/TUI), never silent bank mutation on every boot.
- Creation shows name, bank, source query, and tags before submission.
- **Agent use** selects which seed set applies: `coding` vs `conversation` (real-life / chat agents).
- Tags on seeds must be a subset of retain tags (`source:pi`) so refresh is not empty.
- When models have content, automatic context injects them ephemerally under `<hindsight-mental-models>`; retain strips that injection like recall blocks.
- Seed `max_tokens` stays lean (600 prefs / 800 project) so inject does not dominate every turn (see [coding-memory-evaluation.md](coding-memory-evaluation.md)).
- Template triggers use `mode: delta`, `refresh_after_consolidation: true`, observation-first refresh, and `exclude_mental_models` (oh-my-pi / Claude Code pattern).

## Coding bank-global (shared coding bank)

| Name                                   | Source query (summary)                                                             | Why              |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| Coding assistant operating preferences | Durable plan/verify/commit/tool + clarification style; exclude probe harness rules | Cross-repo prefs |

## Coding project bank

| Name                           | Source query                                                                             | Why                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- | --------------------- |
| Project architecture and seams | What are the stable architecture boundaries, modules, and seams in this project?         | Where changes belong  |
| Project conventions            | What are this project's conventions for code style, build, testing, release, and review? | Consistency           |
| Project decisions              | What durable architectural or product decisions have been made…?                         | Stable decisions only |

## Conversation / life-task project bank

| Name                         | Source query                                                               | Why                    |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Active goals and commitments | What goals, commitments, deadlines, and open loops is the user tracking…?  | Ongoing work           |
| People and context           | Which people, roles, relationships, and recurring situations matter…?      | Durable social context |
| Decisions and preferences    | What durable decisions, preferences, and constraints has the user stated…? | Stable choices         |

## Coding user bank

| Name                                   | Source query                                                 | Why              |
| -------------------------------------- | ------------------------------------------------------------ | ---------------- |
| User collaboration preferences         | Durable collaboration/review/autonomy preferences            | Cross-repo style |
| Coding assistant operating preferences | How coding assistants should plan, verify, commit, use tools | Agent behavior   |
| Cross-project workflow habits          | Issue/PR/release habits across repos                         | Process          |

## Conversation user bank

| Name                                | Source query                           | Why             |
| ----------------------------------- | -------------------------------------- | --------------- |
| Communication preferences           | Tone, length, language preferences     | Response shape  |
| Life and task workflow habits       | Real-life planning and task habits     | LifeOS patterns |
| Priority and scheduling preferences | How the user prioritizes and schedules | Trade-offs      |

## What not to seed

- Secrets, credentials, private URLs
- One-off session status
- Speculative personality profiles
- Project facts in the user bank (and vice versa for coding vs conversation mismatch)

## Template ids

| Id                        | Target  | Agent use             |
| ------------------------- | ------- | --------------------- |
| `pi-coding-project`       | project | coding                |
| `pi-conversation-project` | project | conversation          |
| `pi-coding-user`          | user    | coding                |
| `pi-conversation-user`    | user    | conversation          |
| `pi-user-preferences`     | user    | coding (legacy alias) |
