# PR shepherd workflow

Use the `pr-shepherd` project subagent when a PR needs end-to-end CI, Codex, and merge stewardship without blocking the parent agent.

## Roles

- **Parent/orchestrator** selects the issue slice, decides whether parallel work is safe, creates or names the worktree, and launches the shepherd.
- **PR shepherd** owns exactly one branch and one PR from the supplied worktree.
- **Codex** remains a required review signal before merge.

## Worktree layout

Create one worktree per active PR:

```bash
git fetch origin main
git worktree add ../pi-hindsight-worktrees/pr-263-pr-shepherd -b chore/pr-shepherd-workflow-263 origin/main
```

Prefer a sibling worktree directory outside the repository so generated files and nested Git metadata do not pollute the main checkout.

## Launch shape

Launch the project agent from the PR worktree:

```ts
subagent({
  agent: "pr-shepherd",
  cwd: "../pi-hindsight-worktrees/pr-263-pr-shepherd",
  async: true,
  context: "fresh",
  task: "Own issue #263. Implement the focused workflow slice, open the PR, watch CI and Codex, fix findings, resolve review threads, merge when ready, and report progress to the parent via intercom.",
});
```

If the parent session has a known intercom name, include it in the task so the shepherd can send progress updates and ask blocking questions.

## Shepherd responsibilities

The shepherd must:

1. Confirm issue, branch, base, and cwd before editing.
2. Keep the slice focused and issue-linked.
3. Run targeted checks and `npm run check` before committing.
4. Commit with a Conventional Commit subject without bypassing hooks.
5. Open or update a PR with the full template completed.
6. Watch CI and request Codex review when needed.
7. Fix CI or Codex findings, comment with verification, and resolve fixed review threads.
8. Merge only after required checks pass and Codex has commented, reviewed, or clearly approved.
9. Report merge result, verification, and follow-up issues to the parent.

## Parent responsibilities

The parent should:

1. Keep the main worktree on `main` and clean.
2. Avoid editing files in the shepherd worktree.
3. Continue planning the next slice while the shepherd waits.
4. Start another implementation worktree only when the next slice is independent or explicitly stacked on the shepherd branch.
5. Sync `main` after a shepherd merge before starting dependent work.
6. Delete finished worktrees after merged branches are no longer needed:

```bash
git worktree remove ../pi-hindsight-worktrees/pr-263-pr-shepherd
git worktree prune
```

## Parallel work rule

Parallel next-slice work is safe when it touches separate files or is documentation-only. If the next slice changes the same modules or depends on the PR under review, wait for merge or deliberately stack the new branch on the shepherd branch and rebase after merge.

## Stop conditions

The shepherd must stop and ask the parent when:

- Codex feedback requires a product or scope decision.
- CI failures are not reproducible or not clearly related to the slice.
- A fix would broaden the PR beyond its issue.
- Required live verification is unavailable for a memory-path change.
