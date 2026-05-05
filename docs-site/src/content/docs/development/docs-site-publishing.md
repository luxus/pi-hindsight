---
title: "Docs site publishing"
---

Pi Hindsight publishes the Astro/Starlight documentation site to GitHub Pages from GitHub Actions.

Published URL: <https://luxus.github.io/pi-hindsight/>

## Local preview

Install dependencies and run the local dev server:

```bash
npm install
npm run docs:dev
```

Build and verify the same docs checks used by CI:

```bash
npm run docs:check
```

`docs:check` verifies generated surface-reference freshness, generated code-map freshness, internal docs links/sidebar routes, and the Astro/Starlight build.

## GitHub Pages path

The site is configured for the repository project path in `astro.config.mjs`:

```js
site: "https://luxus.github.io/pi-hindsight",
base: "/pi-hindsight",
```

Keep `base` set to `/pi-hindsight` unless the repository moves to a root-domain Pages deployment. This makes absolute docs links and built assets work under GitHub Pages project hosting.

## Deployment workflow

`.github/workflows/docs-pages.yml` runs on pushes to `main` that touch docs-site inputs and on manual `workflow_dispatch`.

The workflow:

1. enables/configures GitHub Pages for the repository,
2. checks out the repository,
3. installs dependencies with `npm ci --engine-strict`,
4. runs `npm run docs:check`,
5. uploads `docs-site/dist`, and
6. deploys the artifact to GitHub Pages.

Pull requests do not publish. PR validation comes from the normal Check workflow because `npm run check` includes `npm run docs:check`.

## Troubleshooting

- If generated docs are stale, run `npm run surface-reference` or `npm run code-map`, then re-run `npm run docs:check`.
- If a docs link fails locally but works in the browser, prefer relative source links for same-section docs pages. Absolute deployed-site links must include the Pages base path.
- If deployment fails before upload, inspect the build step first; Pages deployment only receives the already-built `docs-site/dist` artifact.
- If the deployed site has broken assets, verify `site` and `base` in `astro.config.mjs` still match the GitHub Pages project URL.
