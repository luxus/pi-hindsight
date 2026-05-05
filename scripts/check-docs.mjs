#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const docsRoot = process.env.DOCS_ROOT
  ? resolve(process.env.DOCS_ROOT)
  : join(process.cwd(), "docs-site", "src", "content", "docs");
const astroConfigPath = process.env.ASTRO_CONFIG_PATH
  ? resolve(process.env.ASTRO_CONFIG_PATH)
  : join(process.cwd(), "astro.config.mjs");
const markdownExtensions = new Set([".md", ".mdx"]);
const sidebarSlugPattern = /slug:\s*["']([^"']+)["']/g;
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const frontmatterPattern = /^---\n([\s\S]*?)\n---\n?/u;
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

function relativeLinkExists(fromFile, href) {
  const target = normalize(join(dirname(fromFile), href)).replace(/[\\/]$/u, "");
  const candidates = extname(target)
    ? [target]
    : [`${target}.md`, `${target}.mdx`, join(target, "index.md"), join(target, "index.mdx")];
  return candidates.some((candidate) => existsSync(candidate));
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

const astroConfig = readFileSync(astroConfigPath, "utf8");
const baseMatch = astroConfig.match(/base:\s*["']([^"']+)["']/u);
const astroBase = baseMatch?.[1]?.replace(/^\//u, "").replace(/[\\/]$/u, "");
const files = walk(docsRoot);
const slugs = new Set(files.map(slugForFile));
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

  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawHref = match[1].trim().replace(/^<|>$/gu, "");
    const href = rawHref.split(/[\s#?]/u)[0];
    if (!href || isExternalOrAnchor(href)) continue;

    if (href.startsWith("/")) {
      const rawSlug = href.replace(/^\//u, "").replace(/[\\/]$/u, "");
      const slug =
        astroBase && rawSlug.startsWith(`${astroBase}/`)
          ? rawSlug.slice(astroBase.length + 1)
          : rawSlug;
      if (!slugExists(slug)) {
        errors.push(`${relative(process.cwd(), file)} links to missing docs route: ${href}`);
      }
      continue;
    }

    if (!relativeLinkExists(file, href)) {
      errors.push(`${relative(process.cwd(), file)} links to missing file: ${href}`);
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
