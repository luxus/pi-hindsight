---
title: "MCP multi-client bank wiring"
description: "Point other AI tools at the same Hindsight banks as Pi via MCP, with a clear source: tag vocabulary."
---

Pi Hindsight is one client of a Hindsight bank. Other tools (Claude Desktop, Cursor, web chat agents, custom MCP hosts) can share the **same banks** over Hindsight’s per-bank MCP endpoint without sharing sessions or providers.

## Point clients at a bank

Hindsight MCP is **per bank**, not a single global memory dump. Wire each client to the bank that matches its mission:

| Role             | Typical bank id   | Use for                                                    |
| ---------------- | ----------------- | ---------------------------------------------------------- |
| Coding           | e.g. `kai-coding` | Engineering decisions, repo project tags, Pi retain/recall |
| Life / assistant | e.g. `kai-life`   | Personal preferences, non-repo assistant memory            |

Endpoint shape (see current Hindsight server docs for the exact host path):

```text
https://<hindsight-host>/mcp/<bankId>/
```

Examples:

```text
https://hindsight.example/mcp/kai-coding/
https://hindsight.example/mcp/kai-life/
```

Local default:

```text
http://localhost:8888/mcp/kai-coding/
```

Configure the client’s MCP server URL to that path. Do **not** point a general-purpose web-chat agent at the coding bank “because it is convenient.”

## Tag vocabulary (always stamp `source:`)

Tags are soft scope inside a bank. Pi and other clients should stay interoperable:

| Tag                  | Who writes it        | Meaning                                                                             |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `source:pi`          | Pi Hindsight         | Memory originated from Pi                                                           |
| `source:<client>`    | Other MCP clients    | e.g. `source:claude`, `source:cursor`, `source:web`                                 |
| `project:<id>`       | Coding bank          | Repo / product scope (stable project identity)                                      |
| `session:<id>`       | Live tools           | Volatile session id — fine on retains; **do not** put in observation project scopes |
| `repo:<slug>-<hash>` | Pi (legacy dual-tag) | Path-hash legacy; dual-tag window only                                              |

**Always stamp `source:`** so you can filter “what did Pi write?” vs “what did the web UI write?” when debugging contamination.

## What not to do

- **Do not dump web chat into the coding bank** by default. Web chat is often personal, noisy, and multi-topic. Prefer the life bank, or a dedicated bank with a clear mission.
- **Do not use one mega-bank** for code + life + medical + random tools. Banks are hard walls; tags are soft scope.
- **Do not rely on metadata alone** for isolation. Use tags (and bank choice) for filtering.
- **Do not put volatile `session:` tags into observation scopes** used for consolidation — they fragment beliefs.

## How this fits Pi Hindsight

- Pi’s default domain topology is a **shared coding bank** + `project:<id>` tags (ADR-005).
- Pi automatic retain stamps `source:pi` and dual-tags `project:` + legacy `repo:`.
- Optional life/user bank is separate; automatic retain never writes life memory (ADR-004).
- Shared/untagged observations inside one bank are opt-in (`scope.includeSharedObservations`); they are **not** cross-bank sharing.

## Checklist for a second client

1. Create or pick bank ids that match Pi config (`banks.project.bankId` / life bank).
2. Point the client MCP URL at `/mcp/<thatBankId>/`.
3. Set the client’s mission text to match the bank mission (engineering vs personal).
4. Configure the client to tag retains with `source:<name>` and, for coding, `project:<id>` when applicable.
5. Verify with a recall from Pi and from the other client that scope isolation still holds.

## Related

- [Memory Banks](/pi-hindsight/concepts/memory-banks/)
- [Project identity and scope tags](/pi-hindsight/concepts/project-identity/)
- [Getting started](/pi-hindsight/start/getting-started/)
- [ADR-005: Domain banks and agent-first surface](/pi-hindsight/architecture/adr/005-domain-banks-and-agent-first-surface/)
- Hindsight: multi-client / MCP docs and “one memory for every AI tool” product notes (upstream)
