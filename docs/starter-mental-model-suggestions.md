# Starter mental model suggestions

Mental models should start as explicit, inspectable user choices. Pi Hindsight may suggest useful recurring questions, but it must not create or refresh mental models automatically during setup.

## Placement decision

Starter suggestions live in docs only, and ad hoc mental models are created and managed in the Hindsight control-plane web UI; Pi does not expose general-purpose mental model creation. Use the suggestions below as copy-paste material when creating custom models in the web UI.

The one exception: the suggestions on this page are also the exact content of pi-hindsight's bundled [bank templates](https://luxus.github.io/pi-hindsight/reference/tools-and-commands/#bank-templates) (`/hindsight:templates`, `/hindsight:template-apply`). Applying one of those two fixed, reviewed templates does create these specific mental models via Hindsight's bank-template import endpoint — a curated, dry-run-gated, explicit-command action, not the general mental-model editor described below. This page is the source of truth for what those bundled mental models ask and why; keep `extensions/banks/bank-templates.ts` in sync with it, not the other way around.

## Product rules

- Suggestions are explicit opt-in.
- No suggestion creates a mental model automatically.
- Creation should show the model name, bank, source query, and tags before submission.
- Refresh remains explicit until a later issue defines safe refresh policy.
- Global models must be conservative and avoid transient project details.
- Suggested source queries should ask for durable patterns, not one-off summaries.
- Suggested tags should reuse existing project/global visibility language.

## Project-bank suggestions

Project mental models should describe durable project facts and operating rules.

| Name                              | Source query                                                                           | Suggested tags                       | Why it helps                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| Project architecture and seams    | What are the stable architecture boundaries, modules, and seams in this project?       | `project`, `architecture`, `stable`  | Helps future turns understand where changes belong.                 |
| Testing and release process       | What test, CI, release, and verification practices does this project use?              | `project`, `workflow`, `release`     | Reduces repeated rediscovery of done criteria and release gates.    |
| Memory safety policy              | What memory rules, safety constraints, and anti-patterns matter in this project?       | `project`, `memory-policy`, `safety` | Keeps retain/recall behavior aligned with project invariants.       |
| Current roadmap and priorities    | What roadmap themes, active priorities, and deferred non-goals recur for this project? | `project`, `roadmap`, `priority`     | Preserves product direction without turning it into hidden backlog. |
| Code style and naming conventions | What code style, naming, module, and testing conventions recur in this project?        | `project`, `conventions`, `style`    | Improves consistency for future implementation work.                |

## Global-bank suggestions

Global mental models should focus on durable collaboration preferences that help across repositories. They should avoid project-specific facts and speculative personality profiles.

| Name                                   | Source query                                                                                                      | Suggested tags                               | Why it helps                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| User collaboration preferences         | What durable preferences has the user shown for collaboration, review, autonomy, and communication?               | `global`, `user-preference`, `collaboration` | Helps agents match working style across projects.                    |
| Coding assistant operating preferences | What durable preferences has the user shown for how coding assistants should plan, verify, commit, and use tools? | `global`, `assistant-workflow`, `preference` | Keeps agent behavior consistent without copying project-local rules. |
| Cross-project workflow habits          | What workflow habits recur across the user's repositories, issue tracking, PR review, and release process?        | `global`, `workflow`, `cross-project`        | Captures reusable process patterns without mixing project details.   |
| Tooling and review preferences         | What tools, checks, review loops, and quality gates does the user repeatedly prefer?                              | `global`, `tooling`, `review`                | Helps pick verification steps and review workflow faster.            |

## What not to suggest

Avoid starter mental models for:

- secrets, credentials, private URLs, or account data
- single-session status reports
- speculative personality traits
- broad autobiographical profiles
- raw conversation summaries
- project facts in the global bank
- global preferences inferred from one isolated project incident

## Web UI handoff

Pi intentionally does not recreate Hindsight's mental model editor. Custom mental models — anything beyond the two bundled bank templates above — are create/edit/refresh/delete only in the Hindsight control-plane web UI. If Pi ever surfaces these suggestions interactively outside of applying a bundled template, it must stay read-only with a web interface handoff, and it should not hide source queries behind friendly labels.

The bundled bank templates are held to a narrower, still-conservative bar: they are exactly the fixed content on this page (no free-form model authoring), applying one is always an explicit command with a dry-run preview, and the preview always shows each model's name, source query, and tags before the user is asked to confirm.
