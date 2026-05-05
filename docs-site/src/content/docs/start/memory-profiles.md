---
title: "Memory profiles"
---

# Memory profiles

Choose the narrowest memory route that fits the repository.

## `project-only`

Safest default.

- Recall reads the Project Bank.
- Automatic Retain writes session deltas to the Project Bank.
- Global/User memory is not used by default.

Use this for sensitive repositories, client work, or any project where memory must stay isolated.

## `project+global`

Best for most personal coding.

- Project facts stay in the Project Bank.
- Durable user preferences and cross-project habits can be recalled from the configured Global/User Bank.
- Automatic Retain still writes project transcript deltas to the Project Bank by default.

Global/User writes remain explicit unless Router Mode is intentionally enabled.

## `global-only`

Broad shared recall.

- Project Bank is disabled.
- Automatic Retain is disabled because there is no project-scoped write route.
- Use explicit Retain when you intentionally want Global/User memory.

## Terminology note

The product is migrating user-facing UI from “global” toward “user” where that is clearer. The glossary still uses **Global Bank** for the configured cross-project bank term. Tool aliases may still accept `global` for compatibility.
