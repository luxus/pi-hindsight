# Configuration

Pi Hindsight resolves configuration from defaults, global config, project config, and environment variables.

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

- **Project + User**: project bank enabled; user bank enabled; user bank settings are written once to global Pi config.
- **Project Only**: project bank enabled; user bank disabled; automatic retain writes to the project bank.
- **User Only**: project bank disabled; user bank enabled from global Pi config.
- **Recall Only**: automatic recall enabled; automatic retain disabled; explicit tools and imports remain available.

When a profile uses user memory, guided setup asks for a user bank ID and writes it to global Pi config. Override it later with `PI_HINDSIGHT_USER_BANK_ID`, `~/.pi/agent/hindsight.json` `banks.user.bankId`, or the setup TUI if you prefer a different shared bank. Legacy `PI_HINDSIGHT_GLOBAL_BANK_ID`, `banks.global`, and `global-only` config names are migrated/supported during transition.

## Bank settings display

Pi Hindsight distinguishes local Pi behavior from bank-owned Hindsight settings. Setup and status surfaces show both:

- `Location: Project` or `Location: User` describes the Pi memory route.
- `Bank: <bank-id>` names the concrete Hindsight bank that owns missions, config overrides, mental models, and directives.

Mission text and mental models remain Hindsight bank settings, not normal Pi JSON config. Use `hindsight_get_bank_config` to inspect resolved bank config and override counts. Use `hindsight_update_bank_config` with `confirm: true` for raw Hindsight per-bank config override fields. Use `hindsight_reset_bank_config` only when you intentionally want to clear bank config overrides and fall back to Hindsight defaults/template state. Use `hindsight_get_bank_template_schema` to fetch the server JSON Schema for portable bank template manifests. Use `hindsight_export_bank_template` with `outputFile` to save a portable manifest JSON file. Use `hindsight_import_bank_template` to dry-run or apply a local/inline manifest; applying requires `dryRun: false` and `confirmApply: true`. Use `hindsight_list_directives`, `hindsight_get_directive`, `hindsight_create_directive`, `hindsight_update_directive`, and `hindsight_delete_directive` to manage bank-owned hard rules.

### Bank config surface audit

Current Hindsight OpenAPI exposes generic per-bank config updates through `BankConfigUpdate.updates`, so Pi exposes raw field updates via `hindsight_update_bank_config` instead of adding local Pi config keys for every server field. High-value per-bank fields supported through raw updates or bank-template manifests include retain extraction/chunking, observation/consolidation limits, reflect source-fact budgets, MCP tool allowlists, retain strategies, and recall budget mapping fields. Keep server-admin or credential-like fields out of Pi local config unless Hindsight documents them as safe per-bank overrides.

## Setup TUI

Run:

```text
/hindsight
```

The setup TUI opens with status facts, then offers focused edit tabs for connection, banks, recall, retain, import, and UI settings. Setting rows show the effective value plus its source (`project`, `global`, `env`, or `default`). Setting descriptions, default values, and all layers are shown inside edit prompts.

Deployment choices cover Hindsight Cloud, an existing local/external API, and local `hindsight-embed` guidance. The local `hindsight-embed` option gives commands to run yourself and can set the base URL to `http://localhost:8888`; it does not manage daemons.

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
  },
  "status": {
    "style": "text",
    "detail": "activity",
    "maxLength": 24,
    "showActivity": true
  },
  "notifications": {
    "startup": true,
    "recall": false,
    "retain": false
  }
}
```
