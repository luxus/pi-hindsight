---
title: "Issue tracker: GitHub"
---

Issues, PRDs, roadmap slices, current work, blockers, and follow-ups for this repo live as GitHub issues for `luxus/pi-hindsight`. Use the `gh` CLI for all operations.

GitHub Issues are the project task ledger. Do not use harness-private TODOs, chat-only plans, local scratch reports, or hidden task lists as the source of truth for project work. If work needs tracking, create or update an issue before continuing.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc or `--body-file` for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments with `jq` when needed and fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside this clone.

## Progress conventions

- Start work by fetching the relevant issue or creating one if none exists.
- Record meaningful progress as issue comments when it affects scope, risk, blockers, or next steps.
- Convert accepted report/review findings into issues; delete or archive the scratch report after the issues carry the actionable content.
- Track follow-ups as new issues or comments on the parent issue, not as hidden local TODOs.
- Close the issue with a comment that names the PR/commit and verification performed.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `luxus/pi-hindsight`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
