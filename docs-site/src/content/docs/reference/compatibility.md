---
title: "Compatibility matrix"
---

Pi Hindsight 1.0 is a Pi-first Hindsight integration. This page is the support contract for the 1.0 line.

## Supported runtime matrix

| Component                   | 1.0 support policy                                                                                                                                                 | Source of truth                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Node.js                     | `>=20`                                                                                                                                                             | `package.json#engines.node`                                          |
| npm                         | `>=10`                                                                                                                                                             | `package.json#engines.npm`                                           |
| Pi runtime packages         | Tested with the `@earendil-works/pi-*` versions pinned in `devDependencies`; peer dependencies accept Pi runtime packages supplied by the host Pi installation.    | `package.json#devDependencies` and `package.json#peerDependencies`   |
| TypeBox                     | `>=1.1.24 <2`                                                                                                                                                      | `package.json#peerDependencies.typebox`                              |
| Hindsight TypeScript client | `@vectorize-io/hindsight-client ^0.6.1`                                                                                                                            | `package.json#dependencies`                                          |
| Hindsight server            | Any server compatible with the official client and the endpoints used by the selected tools. Advanced surfaces are capability-gated where upstream support varies. | `/hindsight:doctor`, live smoke, and official Hindsight API behavior |

## Required Hindsight capabilities

The automatic memory path requires:

- retain
- recall
- reflect
- append-style retain updates (`updateMode: "append"`)
- deterministic document IDs accepted by retain
- tag filters for scoped recall

If append retain is unavailable, live automatic retain is not considered supported for 1.0. `/hindsight:doctor` reports append capability and a remediation action.

## Capability-gated surfaces

These tools are part of the 1.0 Pi surface, but the exact fields and behavior can depend on the connected Hindsight server version:

- native file retain and async operation tracking
- document, entity, graph, tag, memory-unit, and chunk inspection
- memory history and delete-observations repair tools
- mental model history/refresh operation details
- bank template schema import/export
- bank config override fields
- advanced recall/reflect options such as trace, source facts, included chunks, response schemas, and tool-call facts

When a server does not expose one of these endpoints or fields, Pi Hindsight should fail with a clear unsupported-capability message rather than silently changing request shape.

## 1.0 scope decision

For 1.0, Pi Hindsight chooses **stable Pi-first integration** over full upstream global-admin parity.

In scope:

- Pi lifecycle recall/retain integration
- queue-first retain and diagnostics
- deterministic project/user bank routing
- explicit retain/recall/reflect tools
- Pi session and seed import
- scoped bank profile/config/template operations
- inspection and repair tools useful during Pi memory work
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
- append capability and action if unsupported
- memory profile, routes, selected banks, queue state, import state, and activity

Diagnostics must redact API keys and avoid printing raw retained payloads in normal mode.
