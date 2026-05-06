#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const docsRoot = process.env.DOCS_ROOT
  ? resolve(process.env.DOCS_ROOT)
  : join(process.cwd(), "docs-site", "src", "content", "docs");
const astroConfigPath = process.env.ASTRO_CONFIG_PATH
  ? resolve(process.env.ASTRO_CONFIG_PATH)
  : join(process.cwd(), "astro.config.mjs");
const packageManifestPath = process.env.PACKAGE_MANIFEST_PATH
  ? resolve(process.env.PACKAGE_MANIFEST_PATH)
  : join(process.cwd(), "package.json");
const starlightIconsPath = process.env.STARLIGHT_ICONS_PATH
  ? resolve(process.env.STARLIGHT_ICONS_PATH)
  : join(
      process.cwd(),
      "node_modules",
      "@astrojs",
      "starlight",
      "components-internals",
      "Icons.ts",
    );
const explicitLinkCheckPaths = process.env.README_LINK_PATHS
  ? process.env.README_LINK_PATHS.split(",")
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => resolve(path))
  : undefined;
const markdownExtensions = new Set([".md", ".mdx"]);
const sidebarSlugPattern = /slug:\s*["']([^"']+)["']/g;
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const frontmatterPattern = /^---\n([\s\S]*?)\n---\n?/u;
const frontmatterLinkPattern = /^\s*link:\s*["']?([^"'\s]+)["']?\s*$/gmu;
const cardIconPattern = /<Card\b[^>]*\bicon=["']([^"']+)["'][^>]*>/g;
const titlePattern = /^title:\s*(?:"([^"]+)"|'([^']+)'|(.+))\s*$/mu;
const allowedUnlistedSlugs = new Set([
  "",
  "404",
  "architecture",
  "concepts",
  "development",
  "guides",
  "reference",
  "start",
]);

const errors = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return markdownExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function walkAllFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkAllFiles(path);
    return [path];
  });
}

function slugForFile(file) {
  const withoutExtension = relative(docsRoot, file).replace(/\.(md|mdx)$/u, "");
  return withoutExtension
    .split(sep)
    .join("/")
    .replace(/(^|\/)index$/u, "");
}

function candidatesForSlug(slug) {
  const target = join(docsRoot, slug.replace(/^\//u, "").replace(/[\\/]$/u, ""));
  return [`${target}.md`, `${target}.mdx`, join(target, "index.md"), join(target, "index.mdx")];
}

function slugExists(slug) {
  if (slug === "") return true;
  return candidatesForSlug(slug).some((candidate) => existsSync(candidate));
}

function resolveRelativeLink(fromFile, href) {
  const target = normalize(join(dirname(fromFile), href)).replace(/[\\/]$/u, "");
  const candidates = extname(target)
    ? [target]
    : [`${target}.md`, `${target}.mdx`, join(target, "index.md"), join(target, "index.mdx")];
  return candidates.find((candidate) => existsSync(candidate));
}

function relativeLinkExists(fromFile, href) {
  return Boolean(resolveRelativeLink(fromFile, href));
}

function isExternalOrAnchor(href) {
  return /^(https?:|mailto:|#)/iu.test(href);
}

function frontmatterTitle(content) {
  const frontmatter = frontmatterPattern.exec(content)?.[1];
  if (!frontmatter) return undefined;
  const title = titlePattern.exec(frontmatter);
  return title?.[1] ?? title?.[2] ?? title?.[3]?.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDuplicateTitleHeading(content) {
  const title = frontmatterTitle(content);
  if (!title) return false;
  const body = content.replace(frontmatterPattern, "");
  return new RegExp(`^\\s*#\\s+${escapeRegExp(title)}\\s*$`, "imu").test(body);
}

function validateDocsHref(file, rawHref) {
  const href = rawHref
    .trim()
    .replace(/^<|>$/gu, "")
    .split(/[\s#?]/u)[0];
  if (!href || isExternalOrAnchor(href)) return;

  if (href.startsWith("/")) {
    const rawSlug = href.replace(/^\//u, "").replace(/[\\/]$/u, "");
    if (astroBase && rawSlug !== astroBase && !rawSlug.startsWith(`${astroBase}/`)) {
      errors.push(
        `${relative(process.cwd(), file)} links to unbased docs route: ${href}; use /${astroBase}/... so published GitHub Pages links resolve`,
      );
      return;
    }

    const slug =
      astroBase && rawSlug === astroBase
        ? ""
        : astroBase && rawSlug.startsWith(`${astroBase}/`)
          ? rawSlug.slice(astroBase.length + 1)
          : rawSlug;
    if (!slugExists(slug)) {
      errors.push(`${relative(process.cwd(), file)} links to missing docs route: ${href}`);
    }
    return;
  }

  if (!relativeLinkExists(file, href)) {
    errors.push(`${relative(process.cwd(), file)} links to missing file: ${href}`);
  }
}

function packageFileSet() {
  if (!existsSync(packageManifestPath)) return new Set();

  const manifestDir = dirname(packageManifestPath);
  const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  const files = new Set(
    ["package.json", "README.md", "CHANGELOG.md", "LICENSE", "LICENSE.md"]
      .map((path) => join(manifestDir, path))
      .filter((path) => existsSync(path))
      .map((path) => resolve(path)),
  );

  for (const entry of manifest.files ?? []) {
    const path = join(manifestDir, entry);
    if (!existsSync(path)) continue;

    if (statSync(path).isDirectory()) {
      for (const file of walkAllFiles(path)) files.add(resolve(file));
    } else {
      files.add(resolve(path));
    }
  }

  return files;
}

function starlightIconSet() {
  if (!existsSync(starlightIconsPath)) return undefined;
  const content = readFileSync(starlightIconsPath, "utf8");
  const objectBody =
    content.match(/export const BuiltInIcons = \{([\s\S]*?)\n\};/u)?.[1] ?? content;
  const icons = new Set();
  for (const match of objectBody.matchAll(/^\s*(?:["']([^"']+)["']|([A-Za-z][\w-]*))\s*:/gmu)) {
    icons.add(match[1] ?? match[2]);
  }
  return icons;
}

const astroConfig = readFileSync(astroConfigPath, "utf8");
const baseMatch = astroConfig.match(/base:\s*["']([^"']+)["']/u);
const astroBase = baseMatch?.[1]?.replace(/^\//u, "").replace(/[\\/]$/u, "");
const files = walk(docsRoot);
const slugs = new Set(files.map(slugForFile));
const starlightIcons = starlightIconSet();
const sidebarSlugs = new Set(
  [...astroConfig.matchAll(sidebarSlugPattern)].map((match) => match[1]),
);

for (const slug of sidebarSlugs) {
  if (!slugExists(slug)) {
    errors.push(`Sidebar slug does not resolve to a docs page: ${slug}`);
  }
}

for (const slug of slugs) {
  if (!allowedUnlistedSlugs.has(slug) && !sidebarSlugs.has(slug)) {
    errors.push(`Docs page missing sidebar navigation entry: ${slug}`);
  }
}

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (hasDuplicateTitleHeading(content)) {
    errors.push(`${relative(process.cwd(), file)} repeats its frontmatter title as an H1`);
  }

  const frontmatter = frontmatterPattern.exec(content)?.[1];
  for (const match of frontmatter?.matchAll(frontmatterLinkPattern) ?? []) {
    validateDocsHref(file, match[1]);
  }

  for (const match of content.matchAll(markdownLinkPattern)) {
    validateDocsHref(file, match[1]);
  }

  if (starlightIcons) {
    for (const match of content.matchAll(cardIconPattern)) {
      const icon = match[1];
      if (!starlightIcons.has(icon)) {
        errors.push(
          `${relative(process.cwd(), file)} uses unsupported Starlight Card icon: ${icon}`,
        );
      }
    }
  }
}

const packagedFiles = packageFileSet();
const linkCheckPaths =
  explicitLinkCheckPaths ??
  [...packagedFiles].filter((file) => markdownExtensions.has(extname(file)));

for (const file of linkCheckPaths) {
  if (!existsSync(file)) {
    errors.push(`README link check target does not exist: ${relative(process.cwd(), file)}`);
    continue;
  }

  const content = readFileSync(file, "utf8");
  const isPackagedSource = packagedFiles.has(resolve(file));

  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawHref = match[1].trim().replace(/^<|>$/gu, "");
    const href = rawHref.split(/[\s#?]/u)[0];
    if (!href || isExternalOrAnchor(href) || href.startsWith("/")) continue;

    const target = resolveRelativeLink(file, href);
    if (!target) {
      errors.push(`${relative(process.cwd(), file)} links to missing file: ${href}`);
      continue;
    }

    if (isPackagedSource && !packagedFiles.has(resolve(target))) {
      errors.push(
        `${relative(process.cwd(), file)} links to unpackaged local file: ${href}; use a published docs URL or include the target in package files`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Documentation quality checks failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Documentation quality checks passed (${files.length} pages, ${sidebarSlugs.size} sidebar entries).`,
);
