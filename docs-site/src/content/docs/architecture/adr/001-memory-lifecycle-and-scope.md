---
title: "ADR-001: Memory lifecycle and scope policy"
---

# ADR-001: Memory lifecycle and scope policy

## Status

Accepted

## Context

Pi Hindsight needs one coherent lifecycle for recall, retain, queueing, import, and diagnostics.

The MVP currently has the right hook placement and Hindsight defaults, but turn-level policy is distributed across the Pi hook adapter and several helper modules. That makes the core invariant harder to test: recall must happen before provider context, recalled memory must never be retained, retain must store safe session content, writes must be queued before network flush, bank and tag scope must be correct, status must reflect actual outcomes, and failures must degrade predictably.

## Decision

The Pi hook adapter delegates to a MemoryLifecycle module.

MemoryLifecycle owns turn-level policy:

- config reload
- selected bank scopes
- recall execution
- injected-memory handling
- retain gating
- queue orchestration
- status transitions

Memory identity is centralized in MemoryIdentity:

- repo key
- project bank ID
- global bank scope
- session ID
- live document ID
- import document ID
- base tags
- recall tags per bank

Tools and commands call shared intent operations where the same user intent is exposed through multiple Pi surfaces.

## Invariants

- Recalled memory is never retained.
- Project recall is repo-scoped.
- Global recall has explicit non-repo scope.
- Explicit retain always includes base scope tags.
- Retain jobs are durably queued before network flush.
- Disabled memory does not emit active retain or recall status.
- Import document IDs are deterministic.
- Historical import defaults to replace mode.

## Consequences

- `extensions/index.ts` becomes a thin Pi adapter.
- Some current helpers move under lifecycle and identity modules.
- Tests target lifecycle outcomes, not hook implementation details.
- Hindsight HTTP request shapes, Pi JSONL parsing, secret regex internals, and UI rendering strings remain outside MemoryLifecycle.
