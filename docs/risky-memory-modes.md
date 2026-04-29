# Risky memory modes

Pi Hindsight keeps several tempting memory features deferred on purpose. The project is pre-release, so the reason is not backward compatibility. The reason is memory correctness: a feature that makes memory harder to reason about is not worth adding until it has a strong use case and a small, testable design.

## Baseline policy

The safe default path is:

```text
ephemeral recall
fresh recall per turn
queue-first retain
stable document IDs
strict tag scope
explicit commands for user control
```

Do not implement persisted recall, provider recall caching, or prompt hashtag controls unless a future design re-justifies them.

## Persisted recall messages in Pi transcript history

Persisted recall means writing recalled memories into the Pi session transcript as messages so they are visible after restart.

This is deferred.

Risks:

- Old recall blocks can be resent to model providers if filtering is absent or the extension is disabled incorrectly.
- Uninstalling the extension can turn custom recall blocks into ordinary prompt content.
- Recalled memory can accidentally be retained back into Hindsight, causing memory echo.
- Transcript import and cleanup logic becomes harder to reason about.
- Prompt-cache behavior becomes more fragile if historical recall blocks appear in the provider context.

Safe alternative:

- Keep recall ephemeral by default.
- Use `recall.storeLastRecall` to write the latest recall snapshot to a local sidecar file.
- Use `/hindsight:last-recall` to inspect the latest snapshot.
- Use `/hindsight:recall-cleanup` only for accidental persisted recall blocks.

Design rule:

```text
Visibility is OK. Provider reuse is not OK by default.
```

## Provider recall cache

Provider recall cache means reusing previous recall results as context for later model calls.

This is deferred.

Risks:

- Recall is query-dependent; different prompts need different memory.
- Cached recall can serve stale or irrelevant memory.
- Wrong cached memory makes answers confidently wrong.
- Cache invalidation adds complexity without improving correctness.
- It hides retrieval failures behind old results.

Safe alternative:

- Run fresh recall for each turn.
- Cache only for inspection, not provider injection.
- Keep the sidecar snapshot local, explicit, and opt-in.

Design rule:

```text
Recall returns candidates for this query, not reusable truth for future queries.
```

## Prompt hashtag controls such as `#nomem`

Prompt hashtag controls mean parsing user text for markers like `#nomem`, `#private`, `#global`, or `#project`.

This is deferred.

Risks:

- Markdown headings and normal prose use `#`.
- Prompt parsing creates invisible policy decisions inside normal conversation text.
- Agent-written text can accidentally copy or transform control markers.
- Retain cursor behavior becomes harder for one-turn skip semantics.
- Historical import semantics become ambiguous: should old `#nomem` markers still apply?
- Routing tags in prompts invite accidental cross-scope writes.

Safe alternative:

- Use explicit commands:
  - `/hindsight:mode read-only`
  - `/hindsight:mode ignored`
  - `/hindsight:retain off`
- Use `/hindsight:next-opt-out` for command-based one-turn automatic retain opt-out instead of hashtag parsing.

Implemented one-turn direction:

```text
/hindsight:next-opt-out
```

Why this is better:

- Pi command autocomplete makes it discoverable by typing `next`, `opt`, or `out`.
- The command is explicit in command history.
- The behavior can be tested without parsing arbitrary user prose.
- It does not conflict with Markdown.

Current semantics:

- Applies once to the next agent run in the current session.
- Disables automatic retain for that run.
- Leaves recall enabled unless a later design adds an explicit recall option.
- Does not affect explicit `hindsight_retain` tool calls.
- Does not affect historical import.
- Stores non-provider-visible session metadata for inspectability.

Design rule:

```text
Use commands for policy. Do not hide policy in prompt text.
```

## Decision summary

| Feature                              | Status   | Safe alternative                                    |
| ------------------------------------ | -------- | --------------------------------------------------- |
| Persisted recall transcript messages | Deferred | ephemeral recall + last-recall sidecar              |
| Provider recall cache                | Deferred | fresh recall per turn + local inspection snapshot   |
| `#nomem` / prompt hashtag controls   | Deferred | explicit commands such as `/hindsight:next-opt-out` |

## Reopening criteria

A deferred memory mode can be reconsidered only if all are true:

- The use case happens often enough to justify product complexity.
- The behavior can be explained in one paragraph.
- It has deterministic tests for recall, retain, import, and session mode interaction.
- It does not store recalled memory back into Hindsight.
- It fails closed instead of silently leaking memory across scopes.
