---
title: "Testing and verification"
---

Before considering a change done, run the checks required by its impact.

## Default checks

```bash
npm run check
```

For source, tests, critical paths, CI, release, package, or full-CI work, also run:

```bash
npm run check:coverage
npm run typecheck:tsc
```

For documentation-site changes, run the focused docs check while iterating:

```bash
npm run docs:check
```

`docs:check` verifies generated surface-reference freshness, generated code-map freshness, internal docs links/sidebar routes, packaged Markdown links, GitHub Pages base-prefixed docs links, and the Astro/Starlight build. `npm run check` includes `docs:check`, so the normal fast local and PR paths catch docs failures before merge.

For publishing details, see [Docs site publishing](./docs-site-publishing/).

## Memory-path changes

Memory-path behavior includes Retain payloads, Recall queries/formatting, Reflect calls, bank selection, queue delivery, import delivery, Adapter transport, smoke helpers, and package/release changes that can affect installed runtime behavior.

For memory-path changes, prove the live Hindsight path when possible:

```bash
npm run smoke:hindsight
```

If live proof is unavailable, document why and what lower-level checks cover the risk.

## Release/package changes

For release or package dependency changes, run:

```bash
npm run audit:signatures
npm run check:release
```

Also confirm package verification CI or `npm pack --dry-run` when packaging contents are affected.
