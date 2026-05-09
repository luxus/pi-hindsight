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

`docs:check` verifies generated surface-reference freshness, generated code-map freshness, internal docs links/sidebar routes, packaged Markdown links, GitHub Pages base-prefixed docs links, and docs-site build.

## GitHub Pages path

The site is configured for the repository project path in `astro.config.mjs`:

```js
site: "https://luxus.github.io/pi-hindsight",
base: "/pi-hindsight",
```

Keep `base` set to `/pi-hindsight` unless the repository moves to a root-domain Pages deployment. This makes absolute docs links and built assets work under GitHub Pages project hosting.

## Mermaid rendering pipeline

Pi Hindsight uses [`astro-mermaid`](https://github.com/joesaby/astro-mermaid) for Mermaid diagrams.

The pipeline is hybrid:

1. Markdown source keeps normal fenced blocks:

   ````markdown
   ```mermaid
   flowchart LR
     A --> B
   ```
   ````

2. During `astro build`, `astro-mermaid` runs Remark/Rehype transforms before Starlight. Those transforms convert Mermaid fences into `<pre class="mermaid">` blocks.
3. The built HTML still contains `<pre class="mermaid">`. This is expected. SVG is **not** generated at build time.
4. In the browser, the client-side Mermaid runtime renders each `<pre class="mermaid">` into SVG.
5. Theme changes and Astro view transitions re-render diagrams client-side.

Implementation expectations:

- Keep `mermaid()` before `starlight()` in `astro.config.mjs`.
- Keep `mermaid` installed because the browser runtime imports it.
- Keep `@mermaid-js/layout-elk` installed when diagrams use or may use ELK layout. The integration logs `Enabling ELK support` when the optional peer is present.
- Do not add a second custom Mermaid renderer unless a concrete bug proves `astro-mermaid` cannot handle the needed case.

Build logs such as `Remark transformed mermaid block` mean the fence was prepared for client-side rendering. They do not mean build-time SVG rendering happened.

## Deployment workflow

`.github/workflows/docs-pages.yml` runs on pushes to `main` that touch docs-site inputs and on manual `workflow_dispatch`.

The path filter is intentionally narrow because pull requests do not publish and the normal Check workflow already runs `npm run docs:check`. Keep docs-site duplicates only when they are part of the published site, and include every source that can change generated or duplicated site output in the Pages path filter: `docs-site/**`, `astro.config.mjs`, package manifests, docs check/generator scripts, and this workflow. If a future PR starts generating site pages from root Markdown, add those root paths to `.github/workflows/docs-pages.yml` in the same PR.

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
- If Mermaid diagrams show as raw code in the browser, confirm `mermaid()` appears before `starlight()` in `astro.config.mjs`, then check the browser console for `[astro-mermaid]` errors.
- If built HTML contains `<pre class="mermaid">`, that is normal. Verify browser rendering, not build-time SVG output.
- If a docs link fails locally but works in the browser, prefer relative source links for same-section docs pages. Absolute deployed-site links must include the Pages base path.
- If deployment fails before upload, inspect the build step first; Pages deployment only receives the already-built `docs-site/dist` artifact.
- If the deployed site has broken assets, verify `site` and `base` in `astro.config.mjs` still match the GitHub Pages project URL.
