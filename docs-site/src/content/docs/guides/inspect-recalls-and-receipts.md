---
title: "Inspect recalls and retain receipts"
description: Debug what memory was recalled and what retain jobs were accepted.
---

Pi Hindsight keeps recall inspection opt-in so normal transcript history does not persist recalled memory blocks.

## Inspect the last recall

Enable `recall.storeLastRecall: true` and read the sidecar at the configured `recall.lastRecallPath` (default `.pi/hindsight/last-recall.json`). There is no public slash command for last-recall.

Use this when you need to answer:

- what query was sent to Hindsight
- which memory scopes were used
- which candidates were injected
- whether the recall block was omitted because no relevant memory was found

Treat last-recall snapshots as sensitive local debug data because they can include memory text and query excerpts.

## Inspect retain receipts

Recent retain receipts appear in the `/hindsight` status facts. Receipts help identify exact retained document IDs before deletion (in the Hindsight web UI) or deeper debugging.

## Delete exact retained content

Document deletion happens in the Hindsight control-plane web UI. Use the exact Memory Bank ID and Document ID from receipts or import manifests; do not guess IDs.

## Keep debug data local

Do not paste recall snapshots or retained payloads into public issues without redaction. They may include project facts, paths, or user preferences.
