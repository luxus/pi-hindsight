---
title: "Run a local smoke test"
description: Prove the live Hindsight memory path after memory-path or package changes.
---

Use the live smoke test when a change can affect installed runtime memory behavior.

Memory-path changes include retain payloads, recall queries or formatting, Reflect calls, bank selection or creation, queue delivery, import delivery, adapter transport, smoke helpers, and release packaging that can affect installed behavior.

## Configure Hindsight

Point the test at a reachable Hindsight server:

```bash
export HINDSIGHT_BASE_URL=http://localhost:8888
```

If your server needs a key:

```bash
export HINDSIGHT_API_KEY=...
```

## Run smoke

```bash
npm run smoke:hindsight
```

A successful run proves the local code can reach Hindsight and exercise the configured live path.

## CI alternative

The GitHub Actions Hindsight Integration workflow can run the smoke path when configured with:

- `HINDSIGHT_INTEGRATION_ENABLED=true`
- `HINDSIGHT_BASE_URL`
- optional `HINDSIGHT_API_KEY`

For memory-path pull requests, an unconfigured skip is not proof. Run local smoke, get a configured workflow pass, or document why live proof is unavailable and which lower-level checks reduce risk.
