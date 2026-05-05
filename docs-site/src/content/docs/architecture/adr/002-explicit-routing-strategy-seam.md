---
title: "ADR 002: Explicit routing strategy seam"
---

## Status

Proposed.

## Context

Pi Hindsight currently defaults to safe project-local automatic retain. Global automatic retain is disabled unless `globalRetain.mode = "router"` is explicitly enabled.

The current router is intentionally conservative and heuristic. It classifies candidate memory as `project`, `global`, `both`, or `skip`, and `hindsight_route_memory` exposes the decision as a dry run in explicit-only mode. This is useful, but the seam needs a clearer product contract before adding richer bank topologies such as per-user, per-agent, shared-knowledge, or explicit named banks.

The main safety risk is silent global memory pollution. Better routing must not make global writes the default.

## Decision

Routing remains opt-in for automatic writes. `globalRetain.mode = "explicit-only"` stays the default.

Pi Hindsight will treat routing as an explicit strategy seam with stable input and output shapes. The default strategy keeps today's project/global behavior. Future strategies may route to additional bank topologies only behind explicit configuration and dry-run inspection.

## Routing input shape

A routing strategy receives a normalized candidate:

```ts
interface RoutingCandidate {
  content: string;
  context?: string;
  repo?: {
    cwd: string;
    name?: string;
    branch?: string;
    remoteUrl?: string;
  };
  session?: {
    id?: string;
    title?: string;
    cwd?: string;
  };
  message?: {
    role?: "user" | "assistant" | "system" | "tool";
    kind?: "conversation" | "explicit-retain" | "import" | "tool-result";
    timestamp?: string;
  };
  explicitTarget?: "project" | "global" | "both" | "skip" | string;
  identity?: {
    userId?: string;
    agentId?: string;
    channelId?: string;
  };
  config: {
    globalRetainMode: "explicit-only" | "router";
    projectBankId?: string;
    globalBankId?: string;
    globalBankEnabled?: boolean;
  };
  missions: {
    project?: string;
    global?: string;
  };
}
```

Only `content`, `config`, and missions are required for today's implementation. Other fields are forward-compatible context for future strategies.

## Routing output shape

A routing strategy returns an explainable decision:

```ts
interface RoutingDecision {
  route: "project" | "global" | "both" | "skip" | string;
  targets: Array<{
    bankId: string;
    bankRole: "project" | "global" | "user" | "agent" | "shared" | "named";
    tags: string[];
    updateMode?: "append" | "replace";
  }>;
  confidence: number;
  reason: string;
  matchedSignals: string[];
  safetyNotes: string[];
  mode: "explicit-only" | "router";
  writes: string[];
}
```

`hindsight_route_memory` should evolve toward this shape while preserving current fields until a compatibility break is intentional.

## Safety policy

- `explicit-only` means dry-run only. No automatic global writes.
- Router mode must be opt-in and visible in `/hindsight` status/config.
- Global writes require high confidence or explicit user action.
- Ambiguous project+global content should prefer `both` with conservative tags, or ask/dry-run rather than silently picking global.
- Secrets, private URLs, bearer tokens, cookies, and transient artifact paths should route to `skip` or require redaction before retain.
- Metadata records provenance; tags control scope and visibility.
- Recalled memory must not be routed back into retain.

## Strategy seam

Initial strategies:

1. `project-global-default`: current project/global/both/skip classifier using missions and heuristics.
2. `dry-run-only`: always produces an explainable decision but writes nothing.
3. Future `named-bank`: resolves explicit named bank targets once config supports them.
4. Future `identity-aware`: includes per-user/per-agent context only after identity source is documented.

The seam should not know Pi provider internals. It should receive normalized routing input from lifecycle/tool code.

## Eval fixture taxonomy

Routing evals should cover at least:

- durable global preference
- stable identity preference
- cross-project workflow habit
- project architecture fact
- project implementation decision
- project delivery state
- project-scoped user preference
- identity-like fact embedded in project work
- ambiguous project/global content
- secret or credential-like content
- transient screenshot/artifact
- temporary command/test output

Fixtures should assert:

- route
- confidence band or minimum confidence
- matched signal categories
- safety notes where relevant
- write targets in router mode
- no writes in explicit-only mode

## Tool and TUI implications

`hindsight_route_memory` should become the primary dry-run surface for routing decisions. It should show:

- suggested route
- confidence
- target bank roles and IDs
- tags that would be applied
- reason and matched signals
- safety notes
- whether the current mode would write or only preview

A future `/hindsight` TUI route preview can call the same operation and should avoid duplicating routing logic.

## Consequences

- Safe defaults remain unchanged.
- Future routing work has a stable contract instead of adding ad hoc conditions to lifecycle retain.
- Richer bank topologies remain possible without coupling core to a specific platform identity model.
- More tests are required before enabling any new automatic route.

## Follow-up implementation issues

- #154: Update `hindsight_route_memory` presenter to include target bank roles, tags, safety notes, and explicit write/no-write status.
- #155: Expand router eval fixtures with secret/noise/ambiguous confidence cases and safety-note assertions.
- #156: Add a `RoutingStrategy` type and adapter boundary separate from current heuristic implementation.
- Add a future TUI route-preview action that calls the shared routing operation.
- Design named-bank resolver config before supporting per-user/per-agent/shared-bank targets.
