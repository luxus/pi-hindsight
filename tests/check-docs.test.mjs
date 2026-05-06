import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/check-docs.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-hindsight-docs-"));
  const docsRoot = join(root, "docs");
  mkdirSync(join(docsRoot, "start"), { recursive: true });
  writeFileSync(join(docsRoot, "index.mdx"), "---\ntitle: Home\n---\n");
  writeFileSync(join(docsRoot, "start", "getting-started.md"), "---\ntitle: Start\n---\n");
  const astroConfigPath = join(root, "astro.config.mjs");
  const packageManifestPath = join(root, "package.json");
  const readmePath = join(root, "README.md");
  writeFileSync(packageManifestPath, JSON.stringify({ files: ["docs"] }, null, 2));
  writeFileSync(readmePath, "# Fixture\n\n[Start](docs/start/getting-started.md)\n");
  writeFileSync(
    astroConfigPath,
    `export default { integrations: [{ name: "starlight", options: { sidebar: [{ label: "Start", items: [{ label: "Getting started", slug: "start/getting-started" }] }] } }] };\n`,
  );
  return { root, docsRoot, astroConfigPath, packageManifestPath, readmePath };
}

function runCheck({ docsRoot, astroConfigPath }, options = {}) {
  const env = {
    ...process.env,
    DOCS_ROOT: docsRoot,
    ASTRO_CONFIG_PATH: astroConfigPath,
    PACKAGE_MANIFEST_PATH: join(docsRoot, "..", "package.json"),
  };
  if (options.explicitReadmePaths !== false) {
    env.README_LINK_PATHS = join(docsRoot, "..", "README.md");
  }

  return execFileSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("docs quality check", () => {
  it("passes when sidebar slugs and internal links resolve", () => {
    const paths = fixture();
    expect(runCheck(paths)).toContain("Documentation quality checks passed");
  });

  it("fails when a docs page is missing from sidebar navigation", () => {
    const paths = fixture();
    writeFileSync(join(paths.docsRoot, "start", "extra.md"), "---\ntitle: Extra\n---\n");

    expect(() => runCheck(paths)).toThrow(/missing sidebar navigation entry/u);
  });

  it("fails when a sidebar slug points to a missing page", () => {
    const paths = fixture();
    writeFileSync(
      paths.astroConfigPath,
      `export default { integrations: [{ name: "starlight", options: { sidebar: [{ label: "Start", items: [{ label: "Missing", slug: "start/missing" }] }] } }] };\n`,
    );

    expect(() => runCheck(paths)).toThrow(/Sidebar slug does not resolve/u);
  });

  it("accepts query strings and configured Astro base in internal docs links", () => {
    const paths = fixture();
    writeFileSync(
      paths.astroConfigPath,
      `export default { base: "/pi-hindsight", integrations: [{ name: "starlight", options: { sidebar: [{ label: "Start", items: [{ label: "Getting started", slug: "start/getting-started" }] }] } }] };\n`,
    );
    writeFileSync(
      join(paths.docsRoot, "start", "getting-started.md"),
      "---\ntitle: Start\n---\n\n[Self](/pi-hindsight/start/getting-started/?view=full#top)\n",
    );

    expect(runCheck(paths)).toContain("Documentation quality checks passed");
  });

  it("fails when Astro base is configured and a root-absolute docs link omits it", () => {
    const paths = fixture();
    writeFileSync(
      paths.astroConfigPath,
      `export default { base: "/pi-hindsight", integrations: [{ name: "starlight", options: { sidebar: [{ label: "Start", items: [{ label: "Getting started", slug: "start/getting-started" }] }] } }] };\n`,
    );
    writeFileSync(
      join(paths.docsRoot, "start", "getting-started.md"),
      "---\ntitle: Start\n---\n\n[Self](/start/getting-started/)\n",
    );

    expect(() => runCheck(paths)).toThrow(/links to unbased docs route/u);
  });

  it("fails when Astro base is configured and a frontmatter action link omits it", () => {
    const paths = fixture();
    writeFileSync(
      paths.astroConfigPath,
      `export default { base: "/pi-hindsight", integrations: [{ name: "starlight", options: { sidebar: [{ label: "Start", items: [{ label: "Getting started", slug: "start/getting-started" }] }] } }] };\n`,
    );
    writeFileSync(
      join(paths.docsRoot, "index.mdx"),
      "---\ntitle: Home\nhero:\n  actions:\n    - text: Start\n      link: /start/getting-started/\n---\n",
    );

    expect(() => runCheck(paths)).toThrow(/links to unbased docs route/u);
  });

  it("fails when a page repeats its frontmatter title as an H1", () => {
    const paths = fixture();
    writeFileSync(
      join(paths.docsRoot, "start", "getting-started.md"),
      "---\ntitle: Start\n---\n\n# Start\n\nIntro.\n",
    );

    expect(() => runCheck(paths)).toThrow(/repeats its frontmatter title as an H1/u);
  });

  it("fails when an internal docs link points to a missing page", () => {
    const paths = fixture();
    writeFileSync(
      join(paths.docsRoot, "start", "getting-started.md"),
      "---\ntitle: Start\n---\n\n[Missing](/start/missing/)\n",
    );

    expect(() => runCheck(paths)).toThrow(/links to missing docs route/u);
  });

  it("fails when README links to a missing local file", () => {
    const paths = fixture();
    writeFileSync(paths.readmePath, "# Fixture\n\n[Missing](docs/missing.md)\n");

    expect(() => runCheck(paths)).toThrow(/README\.md links to missing file/u);
  });

  it("fails when packaged README links to an unpackaged local file", () => {
    const paths = fixture();
    writeFileSync(paths.packageManifestPath, JSON.stringify({ files: ["README.md"] }, null, 2));
    writeFileSync(paths.readmePath, "# Fixture\n\n[Start](docs/start/getting-started.md)\n");

    expect(() => runCheck(paths)).toThrow(/links to unpackaged local file/u);
  });

  it("checks packaged markdown links by default", () => {
    const paths = fixture();
    writeFileSync(paths.packageManifestPath, JSON.stringify({ files: ["README.md"] }, null, 2));
    writeFileSync(paths.readmePath, "# Fixture\n\n[Start](docs/start/getting-started.md)\n");

    expect(() => runCheck(paths, { explicitReadmePaths: false })).toThrow(
      /links to unpackaged local file/u,
    );
  });

  it("accepts README anchors, query strings, and external docs links", () => {
    const paths = fixture();
    writeFileSync(
      paths.readmePath,
      "# Fixture\n\n[Start](docs/start/getting-started.md?view=full#top)\n[Section](#section)\n[Site](https://luxus.github.io/pi-hindsight/start/getting-started/)\n",
    );

    expect(runCheck(paths)).toContain("Documentation quality checks passed");
  });
});
