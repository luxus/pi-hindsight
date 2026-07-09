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
# Optional automatic-recall quality floors (local drop before inject):
# export PI_HINDSIGHT_MIN_RERANKER=0.2
# export PI_HINDSIGHT_MIN_SEMANTIC=0.65
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

Mission text, bank config overrides, bank templates, mental models, and directives remain Hindsight bank settings, not normal Pi JSON config. Manage them in the Hindsight control-plane web UI. `/hindsight` status surfaces resolved bank config and override counts read-only.

## Compatibility and runtime identity

Pi Hindsight targets the official `@vectorize-io/hindsight-client` package and the current documented Hindsight REST/OpenAPI behavior. The runtime client sends a `pi-hindsight/<package-version>` user-agent on SDK requests. `/hindsight` and debug/status diagnostics surface local package identity, configured server URL, append-mode support, bank reachability, queue state, and failed-consolidation hints where the server exposes them.

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
    "includeSourceFacts": false,
    "maxSourceFactsTokens": 4096,
    "roles": ["user", "assistant"],
    "contextTurns": 2,
    "maxQueryChars": 800,
    "includeRepoHintsInQuery": true,
    "storeLastRecall": false,
    "storeLastRecallFailures": false,
    "lastRecallPath": ".pi/hindsight/last-recall.json",
    "topK": 8,
    "timeoutMs": 40000,
    "cacheTtlMs": 60000,
    "injectionPosition": "append",
    "minScores": {
      "reranker": 0.2,
      "semantic": 0.65
    }
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
    "shutdownFlushTimeoutMs": 2000,
    "postRetainReflect": false
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

`recall.minScores` is optional and defaults to no floors, preserving current automatic-recall
behavior. When set, automatic recall drops results whose returned `scores.semantic`,
`scores.reranker`, `scores.final`, or `scores.keyword` is below the configured floor. Results
with no `scores` object, or with a missing score field, pass through so BM25-only hits and
passthrough rerankers are not silently discarded. `PI_HINDSIGHT_MIN_SEMANTIC` and
`PI_HINDSIGHT_MIN_RERANKER` override the matching config floors when set.

This is independent of the `hindsight_recall` tool's optional `minScores` argument, which is
passed through to the Hindsight API on explicit tool calls.
