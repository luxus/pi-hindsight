---
title: "Inspect recalls and retain receipts"
description: Debug what memory was recalled and what retain jobs were accepted.
---

Pi Hindsight keeps recall inspection opt-in so normal transcript history does not persist recalled memory blocks.

## Inspect the last recall

Use:

```text
/hindsight:last-recall
```

Use this when you need to answer:

- what query was sent to Hindsight
- which memory scopes were used
- which candidates were injected
- whether the recall block was omitted because no relevant memory was found

Treat last-recall snapshots as sensitive local debug data because they can include memory text and query excerpts.

## Inspect retain receipts

Use the explicit receipt tool when available:

```text
hindsight_retain_receipts
```

Receipts help identify exact retained document IDs before deletion or deeper debugging.

## Delete exact retained content

Exact deletion is intentionally strict. Use:

```text
hindsight_delete_document
```

Deletion requires:

- exact Memory Bank ID
- exact Document ID
- `confirm: true`

Do not guess IDs. Inspect receipts or import manifests first.

## Keep debug data local

Do not paste recall snapshots or retained payloads into public issues without redaction. They may include project facts, paths, or user preferences.
