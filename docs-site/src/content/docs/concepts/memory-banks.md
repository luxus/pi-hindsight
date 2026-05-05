---
title: "Memory Banks"
---

A **Memory Bank** is an isolated Hindsight namespace. Banks are the main boundary that prevents unrelated memory from mixing.

## Project Bank

A **Project Bank** is selected for the current repository. It stores repository-specific memory such as:

- architecture decisions
- bugs and fixes
- project conventions
- tools and libraries
- import history
- repo-local preferences

Project recall is scoped with repository tags so unrelated project memories do not leak in.

## Global Bank / User Bank

A **Global Bank** is an optional cross-project bank for durable user-level memory such as:

- stable preferences
- recurring workflows
- coding habits
- assistant collaboration style

The user-facing UI may call this **User** memory where that is clearer. The tool alias `global` remains supported for compatibility.

Automatic Global Bank writes are disabled by default. Use explicit Retain or intentionally enable Router Mode when cross-project writes are desired.

## Bank Alias

A **Bank Alias** is a stable name that resolves to a real Hindsight bank ID:

- `project` resolves to the selected Project Bank.
- `global` resolves to the configured Global/User Bank.

Aliases are useful in tools and documentation when the exact bank ID is not important.

## Tags and metadata

Use tags to filter and isolate memory. Use metadata for provenance.

Examples:

- `source:pi`
- `repo:pi-hindsight`
- `session:<session-id>`
- `profile:coding`

Do not rely on metadata for filtering behavior when scope isolation matters.
