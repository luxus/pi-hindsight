---
title: "Recover the Retain Queue"
description: Flush queued retain jobs and recover after Hindsight outages or failed writes.
---

Pi Hindsight enqueues retain jobs before flushing them to Hindsight. This keeps completed agent runs durable during short outages.

## Check queue state

Open:

```text
/hindsight
```

Confirm:

- queue path is visible
- pending job count is expected
- malformed-line or dead-letter state is not growing
- Hindsight server URL is reachable

## Flush queued jobs

Use either the TUI flush action or:

```text
/hindsight:flush
```

If the flush succeeds, pending jobs should fall and recent receipts should update.

## If Hindsight is down

1. Confirm the Hindsight server is running.
2. Confirm `HINDSIGHT_BASE_URL` or config points at the expected server.
3. Leave the queue files in place.
4. Restart Pi or run `/hindsight:flush` after the server returns.

Do not delete queue files unless you intentionally want to discard pending retain jobs.

## If jobs keep failing

Inspect status first, then check whether the failure is caused by:

- wrong server URL
- missing API key
- missing or deleted bank
- invalid bank template setup
- malformed queue line quarantined by the queue reader

Create a bug report with redacted status output if the queue cannot recover after the server and bank config are valid.
