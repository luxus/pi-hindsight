# ADR 002: Explicit routing strategy seam

## Status

Superseded by [ADR-004](004-lifeos-dual-bank-design.md) (2026-07-03). Kept for historical record; not a live contract.

The typed strategy seam, richer dry-run presenter output, and expanded eval fixtures shipped and were later removed. This ADR's routing-input/output shapes, safety policy, and eval-fixture taxonomy below describe the router as it existed, not current behavior. `userRetain.mode`/`globalRetain.mode` is `"explicit-only"` in every profile today; there is no router mode.

Amendment (2026-06): the `hindsight_route_memory` dry-run tool was removed in the slim-surface rewrite (#417). References to the tool below are historical.

Amendment (2026-07): ADR-004 decided to remove the heuristic memory router entirely rather than revive its dry-run visibility, because it only ever auto-engaged in the narrow "User Only" profile, its own dry-run visibility was already gone, and an unexplainable heuristic classifier making automatic User Bank writes was exactly the silent-pollution risk this ADR warned against. The router, the `RoutingStrategy` seam, and the `"router"` config value were removed; personal-fact retain routing is explicit tools/commands only, matching every other profile.

## Context

Pi Hindsight defaults to safe project-local automatic retain. User Bank automatic retain is disabled unless the user selects a profile or config mode that explicitly enables it. Legacy config/tool aliases still use `global` for this User Bank route.

The current router is intentionally conservative and heuristic. It classifies candidate memory as `project`, `global`, `both`, or `skip`, where `global` is the legacy route name for the configured User Bank. `hindsight_route_memory` exposes the decision as a dry run in explicit-only mode. This is useful, but the seam needs a clear product contract before adding richer bank topologies such as per-user, per-agent, shared-knowledge, or explicit named banks.

The main safety risk is silent User Bank pollution. Better routing must not make User Bank writes the default.

## Decision

Routing remains opt-in for automatic writes. `userRetain.mode = "explicit-only"` stays the default. `globalRetain.mode` remains a legacy compatibility alias, not the preferred user-facing term.

Pi Hindsight treats routing as an explicit strategy seam with stable input and output shapes. The default strategy keeps today's project/User Bank behavior while preserving legacy route values (`project`, `global`, `both`, `skip`) for compatibility. Future strategies may route to additional bank topologies only behind explicit configuration and dry-run inspection.

## Routing input shape

Current implementation uses a compact typed seam:

```ts
interface RoutingCandidate {
  content: string;
  context?: string;
  config: ResolvedConfig;
  cwd?: string;
  projectBankId?: string;
  sessionFile?: string;
}

interface RoutingStrategyInput {
  content: string;
  context?: string;
  config: ResolvedConfig;
  missions: {
    project: string;
    global: string; // legacy route name for User Bank mission
  };
  cwd?: string;
  projectBankId?: string;
  sessionFile?: string;
}
```

Future strategies may add normalized identity or channel context only after the source of that identity is documented.

## Routing output shape

The dry-run operation returns an explainable decision:

```ts
type MemoryRoute = "project" | "global" | "both" | "skip";
type RoutingBankRole = "project" | "global";

interface MemoryRouteDecision {
  route: MemoryRoute;
  confidence: number;
  signals: Array<"project" | "global" | "skip">;
  matchedSignals: string[];
  reason: string;
  mode: "explicit-only" | "router";
  writes: RoutingBankRole[];
  targets: Array<{
    bankRole: RoutingBankRole;
    bankId: string;
    tags: string[];
    willWrite: boolean;
  }>;
  safetyNotes: string[];
  projectMission: string;
  globalMission: string; // legacy route name for User Bank mission
}
```

The legacy `global` route name should be preserved until a compatibility break is intentional. User-facing copy should describe that target as User Bank memory.

## Safety policy

- `explicit-only` means dry-run only. No automatic User Bank writes.
- Router mode must be opt-in and visible in `/hindsight` status/config.
- User Bank writes require high confidence or explicit user action.
- Ambiguous project/User Bank content should prefer `both` with conservative tags, or ask/dry-run rather than silently picking User Bank.
- Secrets, private URLs, bearer tokens, cookies, and transient artifact paths should route to `skip` or require redaction before retain.
- Metadata records provenance; tags control scope and visibility.
- Recalled memory must not be routed back into retain.

## Strategy seam

Implemented strategy:

1. `project-global-default`: current project/User Bank/both/skip classifier using missions and heuristics. The implementation keeps `global` in type names as a legacy route value.

Future strategies:

1. `dry-run-only`: always produces an explainable decision but writes nothing.
2. `named-bank`: resolves explicit named bank targets once config supports them.
3. `identity-aware`: includes per-user/per-agent context only after identity source is documented.

The seam should not know Pi provider internals. It should receive normalized routing input from lifecycle/tool code.

## Eval fixture taxonomy

Routing evals should continue to cover at least:

- durable User Bank preference
- stable identity preference
- cross-project workflow habit
- project architecture fact
- project implementation decision
- project delivery state
- project-scoped user preference
- identity-like fact embedded in project work
- ambiguous project/User Bank content
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

`hindsight_route_memory` remains the primary dry-run surface for routing decisions. It should show:

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

## Follow-up implementation status

Completed:

- #154: Update `hindsight_route_memory` presenter to include target bank roles, tags, safety notes, and explicit write/no-write status.
- #155: Expand router eval fixtures with secret/noise/ambiguous confidence cases and safety-note assertions.
- #156: Add a `RoutingStrategy` type and adapter boundary separate from current heuristic implementation.

Still future:

- Add a TUI route-preview action that calls the shared routing operation.
- Design named-bank resolver config before supporting per-user/per-agent/shared-bank targets.
