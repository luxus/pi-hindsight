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

Project recall is scoped with repository tags so unrelated project memories do not leak in. In Git worktrees, Pi Hindsight resolves the main Git worktree root so linked worktrees of the same repository share the same Project Bank.

## User Bank

A **User Bank** is an optional cross-project bank for durable user-level memory such as:

- stable preferences
- recurring workflows
- coding habits
- assistant collaboration style

Guided setup configures the User Bank once in global Pi config for profiles that use user memory. Repository config then chooses whether the current project participates in user memory.

Automatic retain never writes to the User Bank, in any profile. Use explicit retain (the `hindsight_retain_global` tool or a command) when you want to write user memory.

## Legacy global naming

Older config, tool aliases, and some internal fields may still say **global**. In user-facing docs, **User Bank** is the same cross-project memory concept. The `global` alias remains supported for compatibility.

## Bank Alias

A **Bank Alias** is a stable name that resolves to a real Hindsight bank ID:

- `project` resolves to the selected Project Bank.
- `global` resolves to the configured User Bank.

Aliases are useful in tools and documentation when the exact bank ID is not important.

## Tags and metadata

Use tags to filter and isolate memory. Use metadata for provenance.

Examples:

- `source:pi` (always stamp a `source:` for the client that wrote the memory)
- `project:<stable-id>` (coding bank repo scope; see [project identity](/pi-hindsight/concepts/project-identity/))
- `repo:<slug>-<hash>` (legacy dual-tag window)
- `session:<session-id>`
- `profile:coding`

Do not rely on metadata for filtering behavior when scope isolation matters.

## Multi-client MCP

Other AI tools can share the same banks via Hindsight’s **per-bank** MCP endpoint (`/mcp/<bankId>/`). Keep coding and life banks separate; always stamp `source:`; do not dump web chat into the coding bank. See [MCP multi-client bank wiring](/pi-hindsight/guides/mcp-multi-client/).
