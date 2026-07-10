# Upgrading to domain banks

Pi Hindsight’s default bank topology changed under ADR-005: most repos share a **coding bank** and isolate with stable `project:<id>` tags, instead of one path-hash bank per folder. This guide is for people upgrading an existing install (or anyone who sees **Setup: required** after an update).

Published docs: <https://luxus.github.io/pi-hindsight/guides/upgrading-to-domain-banks/>

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

- stable `project:<id>` (prefer git remote or a pin — see [project identity](project-identity.md))
- legacy `repo:<slug>-<path-hash>`

Recall matches **either** tag, so older memories still surface while new ones get stable tags.

**Unlock auto memory under domain-tagged:** set an explicit coding bank id (even if you keep using a dedicated bank for now), **or** switch to isolated-bank (path 3).

Practical steps:

1. Open `/hindsight` → guided setup (`g`) **or** set `banks.project.bankId` / `PI_HINDSIGHT_PROJECT_BANK_ID`.
2. Prefer `scope.projectIdStrategy: "remote"` (default) or pin `scope.projectId` for weak basename-only repos.
3. Optional: run `hindsight_scope_migrate` (dry-run only) for a local plan/receipt. It never rewrites Hindsight tags.

### 2. Full adopt: shared coding bank

1. `/hindsight` guided setup → **Coding** or **Coding + Life**.
2. Set a shared coding bank id (example: `pi-coding` or your own `kai-coding`).
3. Confirm `scope.mode` is `domain-tagged` and setup is complete.
4. Optional later: reimport Pi sessions into that bank ([importing sessions](importing-sessions.md)).

### 3. Keep hard isolation (closest to older path banks)

```jsonc
{
  "scope": { "mode": "isolated-bank" },
  "banks": { "project": { "enabled": true } },
}
```

Path-derived bank ids remain valid. Pin `banks.project.bankId` if you want a fixed hard-wall bank.

### 4. Freeze on a previous package version

Pin the previous published release of `@luxusai/pi-hindsight` and read the [changelog](https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md). Prefer paths 1–3 when you can.

## Setup gate

- **Domain-tagged** + project bank enabled → requires explicit `banks.project.bankId` (or env). Soft signals alone do **not** unlock auto memory.
- **Isolated-bank** → may use path-derived banks once config/runtime signals show an existing install, or after guided setup.

## Related

- [Project identity](project-identity.md)
- [Getting started](getting-started.md)
- [ADR-005](adr/005-domain-banks-and-agent-first-surface.md)
- [Changelog](https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md)
