---
title: Starter mental model suggestions
---

# Starter mental model suggestions

Mental models should start as explicit, inspectable user choices. Pi Hindsight may suggest useful recurring questions, but it must not create or refresh mental models automatically during setup.

## Placement decision

Starter suggestions should live in three places:

1. **Docs** describe the recommended model set and safety policy.
2. **Setup/TUI** may show the same suggestions as opt-in shortcuts after mental model operations exist.
3. **Bank templates** may reference the same suggestions later, but templates should not silently create models unless the user explicitly imports and confirms that template behavior.

The default setup path should remain lightweight. Suggestions are an advanced affordance, not a first-run requirement.

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

## Future TUI behavior

A future TUI slice should not try to recreate Hindsight's full mental model editor. If starter suggestions become interactive in Pi, prefer one of these lighter options:

1. Show suggestions as read-only copy with a Hindsight web interface handoff.
2. Offer a preview-only dry run of name, source query, tags, and target bank.
3. Defer actual create/edit/refresh/delete to the Hindsight web interface unless a later issue explicitly reopens Pi-side editing.

Pi should not hide source queries behind friendly labels.

## Bank template guidance

Bank template work may reuse these suggestions in one of two safe ways:

- include them as documentation or setup prompts, leaving creation to the user; or
- include model definitions only when the template import preview clearly states which mental models will be created.

Templates must not create global mental models by default. Global template suggestions should require an explicit global-bank import or equivalent confirmation.
