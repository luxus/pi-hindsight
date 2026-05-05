---
title: "Diagnostics and security boundaries"
---

# Diagnostics and security boundaries

Diagnostics should make memory behavior inspectable without exposing secrets or raw retained content unnecessarily.

## Diagnostics boundaries

Diagnostics may show:

- server reachability
- selected bank IDs
- queue counts and error summaries
- import manifests/checkpoints
- retain receipt IDs
- last recall snapshots when explicitly enabled

Diagnostics should avoid printing raw retained payloads in normal mode.

## Security boundaries

Pi Hindsight sanitizes secrets where possible before retain and before persistence/logging. It redacts common tokens, API keys, cookies, bearer headers, and private URLs where possible.

Bank IDs, Document IDs, tags, and metadata are not automatically secret. Treat them as inspectable provenance, but avoid placing credentials there.

## Configuration secrets

Prefer secret references such as:

```json
{
  "hindsight": {
    "apiKey": { "source": "env", "name": "HINDSIGHT_API_KEY" }
  }
}
```

Do not store raw API keys in repository-local config.
