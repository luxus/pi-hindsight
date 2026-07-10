---
title: "Upgrading to domain banks"
description: "Soft dual-tag path vs shared coding bank vs isolated-bank after ADR-005."
---

Pi Hindsight’s default bank topology changed under ADR-005: most repos share a **coding bank** and isolate with stable `project:<id>` tags, instead of one path-hash bank per folder. This guide is for people upgrading an existing install (or anyone who sees **Setup: required** after an update).

## What changed

| Before (path banks)                         | After (domain banks)                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Bank id derived from absolute path          | Explicit coding bank id for shared domain mode                                |
| Isolation mostly by separate banks          | Isolation by `project:<id>` tags (plus dual-tag legacy `repo:`)               |
| Auto memory could run on path-derived banks | **Domain-tagged** auto memory needs `banks.project.bankId` before network I/O |

You do **not** need a bulk tag rewrite to keep working. Soft update is dual-tag + choose a bank model.

## Choose a path

### 1. Soft update (recommended first)

Stay on your current bank content. New retains write **both**:

- stable `project:<id>` (prefer git remote or a pin — see [project identity](/pi-hindsight/concepts/project-identity/))
- legacy `repo:<slug>-<path-hash>`

Recall matches **either** tag, so older memories still surface while new ones get stable tags.

**Unlock auto memory under domain-tagged:** set an explicit coding bank id (even if you keep using a dedicated bank for now), **or** switch to isolated-bank (path C).

Practical steps:

1. Open `/hindsight` → guided setup (`g`) **or** set `banks.project.bankId` / `PI_HINDSIGHT_PROJECT_BANK_ID`.
2. Prefer `scope.projectIdStrategy: "remote"` (default) or pin `scope.projectId` for weak basename-only repos.
3. Optional: ask the agent to run `hindsight_scope_migrate` (dry-run only) for a local plan/receipt. It never rewrites Hindsight tags.

### 2. Full adopt: shared coding bank

Use one coding bank across normal repos; isolate with tags.

1. `/hindsight` guided setup → **Coding** or **Coding + Life**.
2. Set a shared coding bank id (example: `pi-coding` or your own `kai-coding`).
3. Confirm `scope.mode` is `domain-tagged` and `setupComplete` is satisfied.
4. Optional later: reimport Pi sessions into that bank if you want history consolidated ([importing sessions](/pi-hindsight/guides/importing-sessions/)).

Dual-tag stays on until coverage is good enough; drop it only after project-tagged memory is what you rely on (or after a full export/import rebuild).

### 3. Keep hard isolation (closest to older path banks)

```jsonc
{
  "scope": { "mode": "isolated-bank" },
  "banks": { "project": { "enabled": true } },
}
```

Path-derived bank ids remain valid. Pin `banks.project.bankId` if you want a fixed hard-wall bank. Dual-tag still helps after path moves.

### 4. Freeze on a previous package version

If you must not change topology yet, pin the previous published release of `@luxusai/pi-hindsight` and read the [changelog](https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md). Prefer path 1–3 when you can; pin is for temporary freezes, not the long-term product path.

## Setup gate (why auto memory paused)

Automatic bank ensure, recall, and retain stay off until setup is satisfied:

- **Domain-tagged** + project bank enabled → requires explicit `banks.project.bankId` (or env). Soft signals alone (empty project config, queue files, `setupComplete` without bank id) do **not** unlock auto memory.
- **Isolated-bank** → may use path-derived banks once config/runtime signals show an existing install, or after guided setup.

Status shows **Setup: required** and startup can warn with this guide’s URL when notifications are on.

## Inspect without rewriting

| Tool / surface               | Role                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `/hindsight` status / doctor | Shows project tag, bank selection, path-derived warnings           |
| `hindsight_scope_migrate`    | Dry-run plan + local receipt; **never** rewrites tags or documents |
| Guided setup                 | Writes bank ids, profile, and setup completion                     |

## Related

- [Project identity and scope tags](/pi-hindsight/concepts/project-identity/) — dual-tag window, remote vs pin
- [Getting started](/pi-hindsight/start/getting-started/) — first setup and profiles
- [Memory profiles](/pi-hindsight/start/memory-profiles/)
- [ADR-005: Domain banks and agent-first surface](/pi-hindsight/architecture/adr/005-domain-banks-and-agent-first-surface/)
- [Changelog](https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md)
