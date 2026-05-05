---
title: "Package verification"
---

# Package verification

Pi Hindsight is distributed as an npm package. Packaging checks protect installed runtime behavior.

## Published contents

The `package.json` `files` array is the source of truth for package contents. Documentation-site source and generated build output are not runtime package files unless explicitly added.

Before changing package contents, check:

```bash
npm pack --dry-run
```

## Dependency and signature checks

For package dependency changes, run:

```bash
npm run audit:signatures
```

## Release checks

Before merging a release PR or manually publishing a release, confirm:

```bash
npm run check
npm run check:coverage
npm run typecheck:tsc
npm run smoke:hindsight
npm run check:release
```

## Trusted publishing

Release automation publishes through npm trusted publishing with GitHub OIDC. The workflow does not use `NPM_TOKEN`.
