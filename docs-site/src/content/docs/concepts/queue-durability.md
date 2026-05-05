---
title: "Retain Queue durability"
---

Pi Hindsight is queue-first. A **Retain Job** is written to disk before delivery to Hindsight.

This protects memory during:

- Hindsight outages
- network failures
- Pi process shutdowns
- retryable server errors

## Retain Queue

The **Retain Queue** is a JSONL-backed durability layer. Jobs include bank ID, Document ID, content, context, tags, metadata, entities, update mode, and provenance.

The queue supports:

- in-process mutex
- filesystem lock directory for cross-process safety
- stale-lock detection
- malformed-line quarantine
- dead-letter rollover after exhausted retries
- diagnostics that summarize state without logging raw retained content

## Flush paths

Flush queued jobs with:

```text
/hindsight:flush
```

Retain attempts and shutdown also try to flush pending jobs. Periodic flushing can be enabled with `retain.flushIntervalMs` and bounded by periodic/shutdown limits.

## Dead Letter Queue

The **Dead Letter Queue** stores jobs that cannot be delivered after retry policy is exhausted or cannot be represented safely in the active queue.

Dead-letter jobs should remain inspectable and should never be silently discarded.

## Safety

Queue diagnostics must not print raw retained payloads in normal mode. Secrets are sanitized before retain jobs are queued where possible.
