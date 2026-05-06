---
title: "Configuration reference"
---

Pi Hindsight resolves configuration from defaults, global config, project config, and environment variables.

For concepts behind Project Banks, Global/User Banks, tags, metadata, Document IDs, and Update Modes, see:

- [Memory Banks](/pi-hindsight/concepts/memory-banks/)
- [Document IDs and update modes](/pi-hindsight/concepts/document-ids-update-modes/)
- [Retain, Recall, and Reflect](/pi-hindsight/concepts/retain-recall-reflect/)

## Precedence

Config is loaded from:

1. `~/.pi/agent/hindsight.json` or `~/.pi/agent/hindsight.jsonc`
2. `.pi/hindsight.json` or `.pi/hindsight.jsonc` in the current repo
3. environment variables

If both `.json` and `.jsonc` exist at the same scope, `.json` wins. Config is normalized after merging. Unknown fields are ignored, and invalid values fall back to defaults.

Environment variables win the effective value. Project/user stored values can still be edited for future runs after the environment override is removed.

## Common environment variables

```bash
export HINDSIGHT_BASE_URL=http://localhost:8888
export HINDSIGHT_API_KEY=...
# or point config/env at another env var without storing the raw key:
export HINDSIGHT_API_KEY_REF=HINDSIGHT_API_KEY

export PI_HINDSIGHT_ENABLED=true
export PI_HINDSIGHT_PROJECT_BANK_ID=pi-project-my-repo
export PI_HINDSIGHT_USER_BANK_ID=user-luxus
# Legacy fallback still works during migration:
# export PI_HINDSIGHT_GLOBAL_BANK_ID=global-luxus
```

Project config SecretRef shape:

```json
{
  "hindsight": {
    "apiKey": { "source": "env", "name": "HINDSIGHT_API_KEY" }
  }
}
```

## Memory profiles

- `project-only`: Project Bank enabled; user bank disabled; automatic Retain writes to the Project Bank.
- `project+global`: project and user recall enabled; automatic Retain still writes project transcript deltas to the Project Bank by default.
- `global-only`: Project Bank disabled; user recall enabled; automatic Retain disabled.

When a profile enables user memory without an existing bank ID, setup writes `pi-global` as the default user bank ID for compatibility. Override it with `PI_HINDSIGHT_USER_BANK_ID`, `.pi/hindsight.json` `banks.user.bankId`, or the setup TUI if you prefer a different shared bank. Legacy `PI_HINDSIGHT_GLOBAL_BANK_ID` and `banks.global` configs are migrated/supported during transition.

## Bank settings display

Pi Hindsight distinguishes local Pi behavior from bank-owned Hindsight settings. Setup and status surfaces show both:

- `Location: Project` or `Location: User` describes the Pi memory route.
- `Bank: <bank-id>` names the concrete Hindsight bank that owns missions, config overrides, mental models, and directives.

Mission text and mental models remain Hindsight bank settings, not normal Pi JSON config.

Use these tools for bank-owned settings:

- `hindsight_get_bank_config`
- `hindsight_reset_bank_config`
- `hindsight_get_bank_template_schema`
- `hindsight_export_bank_template`
- `hindsight_list_directives`
- `hindsight_get_directive`
- `hindsight_create_directive`
- `hindsight_update_directive`
- `hindsight_delete_directive`

## Advanced project config example

Bank missions are intentionally absent from this JSON example. Hindsight bank configuration/database is the source of truth for retain, reflect, and observation mission text; Pi JSON should only select banks and extension behavior. Existing mission fields in older configs are treated as legacy fallbacks.

```json
{
  "banks": {
    "project": {
      "bankId": "pi-project-my-repo",
      "derive": "manual"
    },
    "user": {
      "enabled": false,
      "bankId": "user-luxus"
    }
  },
  "recall": {
    "budget": "mid",
    "maxTokens": 800,
    "types": ["observation"],
    "roles": ["user", "assistant"],
    "contextTurns": 2,
    "maxQueryChars": 800,
    "includeRepoHintsInQuery": true,
    "storeLastRecall": false,
    "storeLastRecallFailures": false,
    "lastRecallPath": ".pi/hindsight/last-recall.json",
    "topK": 8,
    "timeoutMs": 40000,
    "injectionPosition": "append"
  },
  "observations": {
    "enabled": true,
    "scopes": [["harness:pi"], ["repo:{repoKey}"]]
  },
  "retain": {
    "queuePath": ".pi/hindsight/retain-queue.jsonl",
    "flushIntervalMs": 30000,
    "periodicFlushMaxJobs": 1,
    "periodicFlushTimeoutMs": 2000,
    "updateMode": "append",
    "shutdownFlushMaxJobs": 10,
    "shutdownFlushTimeoutMs": 2000
  },
  "import": {
    "manifestPath": ".pi/hindsight/import-manifest.json",
    "checkpointPath": ".pi/hindsight/import-checkpoint.json",
    "resume": true
  }
}
```

## Generated editable-field reference

The exact generated tool and editable config field surface lives in [Generated surface reference](/pi-hindsight/reference/surface-reference/). Do not edit that generated page by hand; update the operation catalog, config editing registry, or generator.
