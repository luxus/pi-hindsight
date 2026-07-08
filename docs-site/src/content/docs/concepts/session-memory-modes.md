---
title: "Session memory modes"
description: Risk boundaries for normal, read-only, ignored, next-turn opt-out, and setup memory profiles.
---

Session memory modes control automatic Recall and automatic Retain. Prefer the narrowest mode that fits the work.

## Setup profiles

Guided setup chooses the default memory posture for a repository:

- **Project + User**: project memory for repo facts, user memory for durable cross-repo preferences.
- **Project Only**: project memory only.
- **User Only**: user memory only.
- **Recall Only**: automatic recall enabled, automatic retain disabled.

Session commands can temporarily narrow behavior inside that configured profile.

## Normal mode

Normal mode uses the selected profile:

- Recall runs before provider calls.
- Retain runs after completed agent runs when the profile allows automatic retain.
- Project memory writes use stable live-session document IDs.

## Read-only mode

Read-only mode allows Recall but disables automatic Retain.

Use it when you want memory context but do not want the current session written back automatically.

```text
`/hindsight` hub → m → read-only
```

## Ignored mode

Ignored mode turns off automatic memory behavior.

Use it for sensitive work, experiments, or debugging where memory should not affect prompts.

```text
`/hindsight` hub → m → ignored
```

## Next-turn opt-out

Next-turn opt-out skips automatic retain once, then returns to the previous mode.

```text
/hindsight:next-opt-out
```

Use it after a turn that contains sensitive or noisy content.

## Deferred controls

Hashtag-style controls such as `#nomem`, persisted recall messages, cached recall context, and automatic mental-model management remain deferred because they create persistence and prompt-history risks. See [Next opt-out design](../internal/next-opt-out-design/) for internal design context.
