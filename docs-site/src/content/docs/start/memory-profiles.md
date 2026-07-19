---
title: "Memory profiles"
---

Choose the narrowest memory route that fits the repository.

## Coding (shared bank + project tags)

Best for most personal coding (ADR-005 **domain-tagged**).

- One **coding bank** (`banks.project.bankId`) shared across repos.
- Guided setup stores that bank id in **user/global** config so new repos prefill the same id.
- Soft isolation via stable `project:<id>` tags (see [project identity](/pi-hindsight/concepts/project-identity/)).
- Automatic retain writes to the coding bank with project tags.

Use this when you hop between repos and want fewer Hindsight banks.

## Coding + Life (Project + User)

Best for personal coding OS.

- Coding bank as above, plus optional **life/user bank** for durable cross-project prefs.
- Recall can read both; each has its own token budget (`recall.maxTokens` and `recall.userMaxTokens`).
- Automatic retain is coding-bank only; life/user writes stay explicit.

## Isolated project

Hard wall: dedicated bank for this repo (`scope.mode: isolated-bank`), path-derived if no bank id.

Use for sensitive repositories, client work, or any project where memory must never share a bank.

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
