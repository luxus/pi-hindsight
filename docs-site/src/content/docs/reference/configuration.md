---
title: "Configuration reference"
---

Pi Hindsight resolves configuration from defaults, global config, project config, and environment variables.

For concepts behind Project Banks, User Banks, tags, metadata, Document IDs, and Update Modes, see:

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

- **Project + User**: Project Bank enabled; User Bank enabled; user bank settings are written once to global Pi config.
- **Project Only**: Project Bank enabled; User Bank disabled; automatic Retain writes to the Project Bank.
- **User Only**: Project Bank disabled; User Bank enabled from global Pi config.
- **Recall Only**: automatic recall enabled; automatic Retain disabled; explicit tools and imports remain available.

When a profile uses user memory, guided setup asks for a user bank ID and writes it to global Pi config. Override it later with `PI_HINDSIGHT_USER_BANK_ID`, `~/.pi/agent/hindsight.json` `banks.user.bankId`, or the setup TUI if you prefer a different shared bank. Legacy `PI_HINDSIGHT_GLOBAL_BANK_ID`, `banks.global`, and `global-only` config names are migrated/supported during transition.

## Bank settings display

Pi Hindsight distinguishes local Pi behavior from bank-owned Hindsight settings. Setup and status surfaces show both:

- `Location: Project` or `Location: User` describes the Pi memory route.
- `Bank: <bank-id>` names the concrete Hindsight bank that owns missions, config overrides, mental models, and directives.

Mission text and mental models remain Hindsight bank settings, not normal Pi JSON config.

Use these public tools for bank-owned settings:

- `hindsight_get_bank_config`
- `hindsight_update_bank_config`
- `hindsight_reset_bank_config`
- `hindsight_get_bank_template_schema`
- `hindsight_export_bank_template`
- `hindsight_import_bank_template`
- `hindsight_list_directives`
- `hindsight_get_directive`
- `hindsight_create_directive`
- `hindsight_update_directive`
- `hindsight_delete_directive`

## Bank config surface audit

Current Hindsight OpenAPI exposes generic per-bank config updates through `BankConfigUpdate.updates`, so Pi exposes raw field updates via `hindsight_update_bank_config` instead of adding local Pi config keys for every server field. This keeps Hindsight's config resolver as the source of truth.

High-value per-bank fields supported through raw updates or bank-template manifests include:

- retain extraction and chunking: `retain_extraction_mode`, `retain_custom_instructions`, `retain_chunk_size`, `retain_chunk_batch_size`, `retain_default_strategy`, `retain_strategies`
- observation/consolidation controls: `enable_observations`, `observations_mission`, `consolidation_llm_batch_size`, `consolidation_source_facts_max_tokens`, `consolidation_source_facts_max_tokens_per_observation`, `max_observations_per_scope`
- reflect and recall budgets: `reflect_source_facts_max_tokens`, `recall_budget_function`, `recall_budget_fixed_low`, `recall_budget_fixed_mid`, `recall_budget_fixed_high`, `recall_budget_adaptive_low`, `recall_budget_adaptive_mid`, `recall_budget_adaptive_high`, `recall_budget_min`, `recall_budget_max`
- bank behavior and tool policy: `entity_labels`, `entities_allow_free_form`, `mcp_enabled_tools`, disposition fields, directives, and mental models

Keep server-admin or credential-like fields, such as LLM provider credentials and Gemini safety settings, out of Pi local config unless Hindsight documents them as safe per-bank overrides. Use `hindsight_get_bank_config` to inspect resolved config and bank-specific overrides before and after updates.

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
