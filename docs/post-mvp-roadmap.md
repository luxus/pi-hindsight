# Post-MVP Roadmap

This roadmap starts after the MVP hardening pass in `docs/pr-roadmap.md`. The goal is to keep Pi Hindsight simple and Hindsight-correct while improving inspectability and user control.

## Product rule

Do not promote a deferred idea into implementation just because it appears in a roadmap. Deferred means the idea has known risks and must be re-justified before implementation.

The default memory path remains:

```text
ephemeral recall
queue-first retain
stable document IDs
append for live sessions
tag-scoped project/global memory
explicit tools and commands
```

## Safe next work

### PR 8: Document risky memory modes

**Status:** completed.

**Purpose:** Explain why several tempting features are deferred and what safe alternatives already exist.

**Scope:**

- Add a README/docs section for risky memory modes.
- Explain persisted recall transcript risks.
- Explain provider recall cache risks.
- Explain hashtag prompt-control risks.
- Point users to safe alternatives:
  - ephemeral recall
  - `recall.storeLastRecall` sidecar
  - `/hindsight:last-recall`
  - `/hindsight:mode`
  - `/hindsight:retain`

**Acceptance criteria:**

- The docs clearly say these features are not planned for the default path.
- A future LLM agent can explain why these ideas are deferred without re-litigating them.
- No code behavior changes.

**Checks:**

```bash
npm run format
```

### PR 9: Improve last-recall inspection UX

**Status:** next.

**Purpose:** Make cached recall useful for inspection without reusing stale recall as provider context.

**Scope:**

- Improve `/hindsight:last-recall` output.
- Show useful summary fields:
  - snapshot timestamp
  - bank IDs
  - query excerpt
  - memory counts per bank
  - sidecar file path
- Consider an explicit JSON/detail mode if it fits the command style.
- Keep the sidecar opt-in and local-only.
- Do not reuse last recall as automatic provider context.

**Acceptance criteria:**

- Users can inspect the latest recall without opening JSON manually.
- The command makes clear that last recall is for visibility, not automatic reuse.
- Tests cover missing, malformed, and valid snapshots.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
```

### PR 10: Design command-based one-turn opt-out

**Status:** planned.

**Purpose:** Give users fast memory control without prompt hashtag parsing.

**Design direction:** use explicit Pi commands, not `#nomem`.

Preferred command shape:

```text
/hindsight:next-opt-out
```

Possible aliases or future variants:

```text
/hindsight:next-retain off
/hindsight:next-mode ignored
/hindsight:next-recall off
```

Reason for a dedicated command:

- Pi command autocomplete makes it discoverable by typing `next`, `opt`, or `out`.
- It avoids parsing user prompts and Markdown headings.
- It is explicit in the command history.
- It can have precise behavior and tests.

Open design questions:

- Should the next turn disable retain only, recall only, or both?
- Should the command apply to the next user prompt, the next agent run, or the next completed retain delta?
- How should it interact with `/hindsight:mode read-only|ignored`?
- Should the setting survive process restart, or be in-memory only?
- Should it affect historical imports? Default answer should be no.

Initial recommendation:

```text
/hindsight:next-opt-out
```

Behavior:

- Applies once to the next agent run in the current session.
- Disables automatic retain for that run.
- Leaves recall enabled unless the command later grows a `--recall` option.
- Does not affect explicit `hindsight_retain` tool calls.
- Does not affect historical import.
- Records non-provider-visible session metadata so it is inspectable and testable.

**Scope:**

- Write the design and test plan first.
- Implement only after the exact behavior is accepted.
- Do not implement hashtag parsing.

**Acceptance criteria for design PR:**

- The command name and one-turn semantics are documented.
- Import/cursor/session-mode interactions are specified.
- The out-of-scope list explicitly rejects prompt hashtags for now.

**Checks:**

```bash
npm run format
```

### PR 11: Global codebase review loop

**Status:** planned.

**Purpose:** Review the whole extension after MVP hardening and before more feature work.

**Process:**

1. Run multiple reviewer agents in parallel.
2. Include comparison context from `noctuid/pi-hindsight`.
3. Check official Hindsight docs/client behavior where relevant.
4. Group findings by severity:
   - correctness
   - safety/security
   - Hindsight best-practice alignment
   - Pi lifecycle alignment
   - test gaps
   - docs/onboarding gaps
5. Fix only real issues.
6. Pre-review each fix before PR.
7. Request Codex review on the PR.
8. Repeat until reviewers and Codex find no blockers.

**Acceptance criteria:**

- Findings are recorded in an issue or review document.
- Every accepted finding has either a fix, test, doc update, or explicit no-action decision.
- The loop stops only when remaining findings are deferred/non-blocking.

**Checks:**

```bash
npm run check
npm run typecheck:tsc
npm run smoke:hindsight # when live behavior changes and server is available
```

## Explicitly deferred ideas

These remain deferred and should not be implemented without a new design discussion.

### Persisted recall messages in Pi transcript history

Why deferred:

- Old recall blocks can be resent to providers if filtering is absent.
- Uninstalling the extension can turn custom recall blocks into prompt pollution.
- Recalled memory can accidentally be retained back into Hindsight.
- It complicates import, cleanup, and transcript semantics.

Safe alternative:

- Keep recall ephemeral.
- Use `recall.storeLastRecall` and `/hindsight:last-recall` for visibility.

### Provider recall cache

Why deferred:

- Recall is query-dependent.
- Cached recall can serve stale or irrelevant memory.
- It makes wrong answers faster and harder to debug.

Safe alternative:

- Keep fresh recall per turn.
- Cache only for inspection via sidecar snapshots.

### Prompt hashtag controls such as `#nomem`

Why deferred:

- Markdown headings and normal prose use `#`.
- Prompt parsing creates edge cases and invisible policy decisions.
- It complicates retain cursor and historical import semantics.

Safe alternative:

- Use explicit commands such as `/hindsight:mode`, `/hindsight:retain`, and a future `/hindsight:next-opt-out`.

### Linked hosts / multi-Hindsight-server routing

Why deferred:

- Multiple banks cover most separation needs.
- Multi-server routing adds latency and configuration complexity.
- The use case is not yet proven.

### Generic memory backend abstraction

Why deferred:

- One backend does not justify a broad abstraction.
- Hindsight best practices would be diluted into lowest-common-denominator behavior.

### Automatic mental-model management

Why deferred:

- Mental models are powerful but need clear product governance.
- Automatic updates can create stale or overconfident profiles.

### Bank administration UI

Why deferred:

- Hindsight already has bank administration tooling.
- Destructive admin operations are risky inside a coding-agent extension.

### OpenClaw-style dynamic routing

Why deferred:

- The current `project-only`, `project+global`, and `global-only` profiles are easier to audit.
- Dynamic routing makes memory provenance harder to reason about.

### Large prompt or skill bundles

Why deferred:

- They increase maintenance burden and onboarding size.
- Tool descriptions and docs are enough for the current MVP.
