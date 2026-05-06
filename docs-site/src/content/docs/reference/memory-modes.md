---
title: "Memory modes reference"
description: Exact automatic recall and retain behavior for supported session memory modes.
---

| Mode              | Automatic Recall | Automatic Retain | Intended use                            |
| ----------------- | ---------------- | ---------------- | --------------------------------------- |
| normal            | enabled          | enabled          | default memory behavior                 |
| read-only         | enabled          | disabled         | use memory without writing this session |
| ignored           | disabled         | disabled         | sensitive or isolated work              |
| next-turn opt-out | unchanged        | skipped once     | skip one noisy or sensitive retain      |

## Commands

```text
/hindsight:mode read-only
/hindsight:mode ignored
/hindsight:mode normal
/hindsight:next-opt-out
```

See [Session memory modes](../concepts/session-memory-modes/) for risk guidance.
