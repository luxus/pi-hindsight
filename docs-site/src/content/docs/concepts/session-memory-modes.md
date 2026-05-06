---
title: "Session memory modes"
description: Risk boundaries for read-only, ignored, next-turn opt-out, and deferred memory modes.
---

Session memory modes control automatic Recall and automatic Retain. Prefer the narrowest mode that fits the work.

## Normal mode

Normal mode uses the selected profile:

- Recall runs before provider calls.
- Retain runs after completed agent runs.
- Project memory writes use stable live-session document IDs.

## Read-only mode

Read-only mode allows Recall but disables automatic Retain.

Use it when you want memory context but do not want the current session written back automatically.

```text
/hindsight:mode read-only
```

## Ignored mode

Ignored mode turns off automatic memory behavior.

Use it for sensitive work, experiments, or debugging where memory should not affect prompts.

```text
/hindsight:mode ignored
```

## Next-turn opt-out

Next-turn opt-out skips automatic retain once, then returns to the previous mode.

```text
/hindsight:next-opt-out
```

Use it after a turn that contains sensitive or noisy content.

## Deferred controls

Hashtag-style controls such as `#nomem`, persisted recall messages, cached recall context, and automatic mental-model management remain deferred because they create persistence and prompt-history risks. See [Next opt-out design](../internal/next-opt-out-design/) for internal design context.
