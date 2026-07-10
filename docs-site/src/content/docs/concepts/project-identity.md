---
title: "Project identity and scope tags"
---

Pi Hindsight tags project memories so recall stays scoped to the current repository. Identity is **stable across absolute path moves** when possible (ADR-005).

## Resolution order

1. **Pin** — `scope.projectId` in `.pi/hindsight.json` or global config
2. **Git remote** — normalized `origin` URL (default strategy)
3. **Basename** — git root folder name (fallback, or when `scope.projectIdStrategy` is `"basename"`)

Examples:

| Source                               | Tag                                  |
| ------------------------------------ | ------------------------------------ |
| pin `finalform`                      | `project:finalform`                  |
| `git@github.com:luxus/finalform.git` | `project:github-com-luxus-finalform` |
| folder `finalform` (no remote)       | `project:finalform`                  |

## Dual-tag window

Each retain also still writes the legacy path-hash tag `repo:<slug>-<hash>` and recall matches **either** `project:<id>` or that legacy tag (`any_strict`). That keeps older banks usable after the tag change and after Mac↔Linux path moves for new `project:` tags.

Doctor/status (`/hindsight` doctor, debug report) shows:

- active `project:` tag
- derivation basis (`pin` / `remote` / `basename`) and source
- legacy `repo:` tag
- `scopeMigrate` dry-run findings (path-derived bank, legacy path-hash tag, weak basename identity, guidance)

## Scope migrate dry-run (no silent rewrite)

Use the agent tool `hindsight_scope_migrate` (or doctor report) for a **dry-run only** migration plan:

- Confirms dual-tag is active
- Flags path-derived coding banks under domain-tagged mode
- Explains when legacy `repo:*` path-hashes miss after path moves
- Optionally accepts a bank tag sample for hit counts
- Writes a receipt to `.pi/hindsight/scope-migrate-receipt.json`

It **never** rewrites Hindsight tags or documents. For rebuilds:

1. Prefer Hindsight document/bank export-import when available
2. Otherwise reimport Pi transcripts with `replace` into the shared coding bank
3. Keep dual-tag until project-tagged coverage is good enough

When dual-tag can end: every active project memory you care about carries `project:<id>` (or you completed a full export/import rebuild).

## Scope mode (bank topology)

| Mode                          | Bank                                           | Tags                          |
| ----------------------------- | ---------------------------------------------- | ----------------------------- |
| **`domain-tagged`** (default) | Shared coding bank (`banks.project.bankId`)    | `project:<id>` isolates repos |
| **`isolated-bank`**           | Hard wall per repo (path-derived if no bankId) | project tags still written    |

`banks.coding` aliases `banks.project`. `banks.life` aliases `banks.user`.

## Config

```jsonc
// ~/.pi/agent/hindsight.json
{
  "setupComplete": true,
  "scope": { "mode": "domain-tagged", "projectIdStrategy": "remote" },
  "banks": {
    "project": { "enabled": true, "bankId": "kai-coding", "derive": "manual" },
    "user": { "enabled": true, "bankId": "kai-life" }
  }
}

// .pi/hindsight.json
{
  "scope": { "projectId": "finalform" }
}
```

Env: `PI_HINDSIGHT_PROJECT_BANK_ID` sets the coding bank id (setup gate).

## Observation scopes

Default observation scopes use `project:{projectId}` (not session tags). Legacy placeholder `{repoKey}` still expands if present in custom scopes.
