---
title: "Memory profiles"
---

Choose the narrowest memory route that fits the repository.

## Project + User

Best for most personal coding.

- Recall can read project memory and user memory. Project Bank recall and User Bank recall each have their own token budget (`recall.maxTokens` and `recall.userMaxTokens`), so enabling User Bank recall does not silently grow the total context injected per turn.
- Automatic retain writes repository session deltas to the Project Bank.
- User Bank settings are stored once in global Pi config and reused across repositories.

Use this when you want repo-specific memory plus durable cross-repo preferences and workflows.

## Project Only

Best for strict isolation.

- Recall reads the Project Bank.
- Automatic retain writes session deltas to the Project Bank.
- User memory is not used by default.

Use this for sensitive repositories, client work, or any project where memory must stay isolated.

## User Only

Best for non-repo assistance.

- Project Bank is disabled.
- User Bank settings are stored in global Pi config.
- Automatic retain is off, same as every other profile; use `hindsight_retain_global` or a command to write User Bank memory explicitly.

Use this when project-specific memory would be noise but user preferences still matter.

## Recall Only

Best for cautious adoption.

- Automatic recall stays enabled.
- Automatic retain is disabled.
- Explicit tools and import remain available.

Use this when you want memory context but do not want the current session written automatically.

## Terminology note

User-facing docs and setup use **User Bank** for cross-project memory. Older config, internal fields, and tool aliases may still say `global`; that alias remains supported for compatibility.
