---
title: "Compatibility matrix"
---

Pi Hindsight 1.0 is a Pi-first Hindsight integration. This page is the support contract for the 1.0 line.

## Supported runtime matrix

| Component                   | 1.0 support policy                                                                                                                                                                                                          | Source of truth                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Node.js                     | `>=20`                                                                                                                                                                                                                      | `package.json#engines.node`                                          |
| npm                         | `>=10`                                                                                                                                                                                                                      | `package.json#engines.npm`                                           |
| Pi runtime packages         | Tested with the `@earendil-works/pi-*` versions pinned in `devDependencies`; peer dependencies accept Pi runtime packages supplied by the host Pi installation.                                                             | `package.json#devDependencies` and `package.json#peerDependencies`   |
| TypeBox                     | `>=1.1.24 <2`                                                                                                                                                                                                               | `package.json#peerDependencies.typebox`                              |
| Hindsight TypeScript client | `@vectorize-io/hindsight-client ^0.9.0`                                                                                                                                                                                     | `package.json#dependencies`                                          |
| Hindsight server            | **Hindsight 0.8+** with append `update_mode` support, compatible with `@vectorize-io/hindsight-client ^0.9.0`. Knowledge pages need server routes that match the 0.9 client; other advanced surfaces stay capability-gated. | `/hindsight:doctor`, live smoke, and official Hindsight API behavior |

## Required Hindsight capabilities

The automatic memory path requires:

- retain
- recall
- reflect
- append-style retain updates (`updateMode: "append"`)
- deterministic document IDs accepted by retain
- tag filters for scoped recall

If append retain is unavailable, live automatic retain is not considered supported for 1.0. Upgrade to Hindsight 0.8+; `/hindsight:doctor` documents the server floor and remediation action.

Hindsight 0.10 retired `GET /banks/{id}/profile` (HTTP 410 Gone). Bank ensure, status, guided setup, import target validation, and live smoke use `GET /v1/default/banks?q=` with an exact `bank_id` match for existence. `hindsight_bank` get still returns stats/config when `/profile` is retired. Health fallback uses that same list-banks endpoint as a server reachability ping and does not require an exact id match. That is not a public `list_banks` tool. `GET /banks/{id}/config` is not an existence check: it can 200 for a missing bank.

## Capability-gated surfaces

These surfaces are part of the 1.0 Pi surface, but the exact fields and behavior can depend on the connected Hindsight server version:

- advanced recall/reflect options such as trace, source facts, included chunks, response schemas, and tool-call facts
- knowledge pages (`hindsight_knowledge`) — requires `@vectorize-io/hindsight-client ^0.9.0` and a server that exposes knowledge-base APIs
- read-only bank config/stats facts in status

When a server does not expose one of these endpoints or fields, Pi Hindsight should fail with a clear unsupported-capability message rather than silently changing request shape. Admin and browsing surfaces (documents, entities, graphs, tags, memory units, mental models, directives, bank templates, operations) live in the Hindsight control-plane web UI.

## 1.0 scope decision

For 1.0, Pi Hindsight chooses **stable Pi-first integration** over full upstream global-admin parity.

In scope:

- Pi lifecycle recall/retain integration
- queue-first retain and diagnostics
- deterministic project/user bank routing
- explicit retain/recall/reflect tools
- Pi session import
- live smoke and package/release verification

Out of scope for 1.0 unless a follow-up issue explicitly pulls them in:

- cross-bank `list_banks`
- arbitrary cross-bank `create_bank`
- full-bank `delete_bank`
- platform-wide bank statistics/admin dashboards
- audit log and webhook administration
- generic non-Pi framework adapters in this package

Rationale: global-admin and platform surfaces carry broader safety, permission, and UX obligations than the Pi memory lifecycle. Pi Hindsight can still expose scoped bank operations that directly help Pi users inspect, repair, or configure their selected project/user banks.

## Diagnostics contract

`/hindsight:doctor` and status-style diagnostics should report:

- Pi Hindsight package version and user agent
- supported runtime ranges from this matrix
- configured Hindsight base URL without secrets
- official Hindsight client package and supported range
- health reachability
- server floor (Hindsight 0.8+ append retain) and remediation action
- memory profile, routes, selected banks, queue state, import state, and activity

Diagnostics must redact API keys and avoid printing raw retained payloads in normal mode.
