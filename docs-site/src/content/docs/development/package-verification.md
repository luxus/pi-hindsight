---
title: "Package verification"
---

Pi Hindsight is distributed as an npm package. Packaging checks protect installed runtime behavior.

## Runtime compatibility

Supported runtime and package ranges are declared in `package.json` and enforced in CI with `npm ci --engine-strict`.

- Node.js: `>=24 <26`
- npm: `>=11 <12`
- Pi peer packages: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-tui` use `*` because Pi supplies runtime packages.
- TypeBox peer package: `typebox >=1.1.24 <2`

Pi Hindsight versions with these peers require Pi packages from the `@earendil-works` scope and are tested locally against Pi `0.74.0` dev dependencies. Older Pi installs that only provide the retired `@mariozechner` scope are no longer supported by this compatibility line.

Keep this compatibility detail in maintainer docs instead of the README unless the install story changes.

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
