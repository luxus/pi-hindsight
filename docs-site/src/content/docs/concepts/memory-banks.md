---
title: "Memory Banks"
---

A **bank** is a hard wall in Hindsight: memory in one bank never mixes with another bank.

Tags (for example `project:my-app`) only filter **inside** a bank. They do not cross bank walls.

## Start here: Coding bank (recommended)

Most people need **one coding bank** shared across normal repos.

|                              | Coding bank                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| **What it is**               | Shared engineering memory for your coding work                      |
| **What goes in**             | Architecture, conventions, bugs, decisions, repo history            |
| **How repos stay separate**  | Soft isolation with `project:<id>` tags (not a new bank per folder) |
| **Who writes automatically** | Automatic retain after each agent turn                              |
| **Where the id lives**       | Usually user/global config (guided setup prefills it for new repos) |
| **Typical id**               | `pi-coding` (or any name you choose once)                           |

**Pick this unless** the repo is sensitive client work or must never share a bank.

Config field: `banks.project.bankId` (legacy docs may still say “Project Bank” for this path).

## Optional: Life / User bank

A **second** bank for _you_, not for a repo.

|                        | Life / User bank                                                  |
| ---------------------- | ----------------------------------------------------------------- |
| **What it is**         | Cross-project personal memory                                     |
| **What goes in**       | Stable preferences, workflows, people, goals, collaboration style |
| **Automatic retain?**  | **Never** — only explicit tools/commands                          |
| **Where the id lives** | User/global Pi config                                             |

Enable only when you want personal memory alongside coding. Guided setup profile: **Coding + Life**.

Older config and tools may still say `global` for this bank. Same idea.

## Escape hatch: Isolated bank

One **dedicated** bank for a single repo. Hard wall; no shared coding bank.

Use for client work, secrets, or “this repo must not share memory with anything else.”

Guided setup profile: **Isolated project**. Path-derived bank id is fine if you leave the default.

## Quick compare

| Need                                  | Use                           |
| ------------------------------------- | ----------------------------- |
| Normal coding across many repos       | **Coding bank** (recommended) |
| Coding + personal prefs/goals         | **Coding + Life**             |
| This repo must be fully walled off    | **Isolated bank**             |
| Personal memory only (no repo memory) | **Life only**                 |

## Bank aliases in tools

Stable names that resolve to real bank ids:

- `project` → active coding bank (or isolated bank for this repo)
- `global` / `user` → Life / User bank when configured

## Tags and metadata

Use **tags** for scope. Use **metadata** only for provenance (links back to source).

Common tags:

- `source:pi` (always stamp which client wrote the memory)
- `project:<stable-id>` (repo scope inside the coding bank)
- `repo:<slug>-<hash>` (legacy dual-tag window)
- `session:<session-id>`

Do not rely on metadata for filtering when isolation matters.

## Multi-client MCP

Other tools can share the same banks via Hindsight’s per-bank MCP (`/mcp/<bankId>/`). Keep coding and life banks separate; always stamp `source:`; do not dump web chat into the coding bank. See [MCP multi-client bank wiring](/pi-hindsight/guides/mcp-multi-client/).
