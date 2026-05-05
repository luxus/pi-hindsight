import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://luxus.github.io/pi-hindsight",
  base: "/pi-hindsight",
  srcDir: "./docs-site/src",
  outDir: "./docs-site/dist",
  integrations: [
    starlight({
      title: "Pi Hindsight",
      disable404Route: true,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/luxus/pi-hindsight" }],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Getting started", slug: "start/getting-started" },
            { label: "Installation", slug: "start/installation" },
            { label: "Setup TUI", slug: "start/setup-tui" },
            { label: "Memory profiles", slug: "start/memory-profiles" },
            { label: "Minimal configuration", slug: "start/minimal-config" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Memory Banks", slug: "concepts/memory-banks" },
            { label: "Retain, Recall, and Reflect", slug: "concepts/retain-recall-reflect" },
            {
              label: "Document IDs and update modes",
              slug: "concepts/document-ids-update-modes",
            },
            { label: "Retain Queue durability", slug: "concepts/queue-durability" },
            { label: "Historical Import", slug: "concepts/imports" },
            { label: "Memory behavior", slug: "concepts/memory-behavior" },
            { label: "Hindsight core functions", slug: "concepts/hindsight-core-functions" },
            {
              label: "Starter mental model suggestions",
              slug: "concepts/starter-mental-model-suggestions",
            },
          ],
        },
        {
          label: "Guides",
          items: [{ label: "Importing sessions", slug: "guides/importing-sessions" }],
        },
        {
          label: "Reference",
          items: [
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Tools and commands", slug: "reference/tools-and-commands" },
            { label: "Hooks", slug: "reference/hooks" },
            { label: "Import controls", slug: "reference/import-controls" },
            { label: "Generated surface reference", slug: "reference/surface-reference" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "Lifecycle and scope", slug: "architecture/lifecycle-and-scope" },
            {
              label: "Core vs companion adapters",
              slug: "architecture/core-vs-companion-adapters",
            },
            { label: "Queue and import architecture", slug: "architecture/queue-and-import" },
            {
              label: "Diagnostics and security boundaries",
              slug: "architecture/diagnostics-and-security",
            },
            {
              label: "ADRs",
              items: [
                {
                  label: "ADR 001: Memory lifecycle and scope",
                  slug: "architecture/adr/001-memory-lifecycle-and-scope",
                },
                {
                  label: "ADR 002: Explicit routing strategy seam",
                  slug: "architecture/adr/002-explicit-routing-strategy-seam",
                },
                {
                  label: "ADR 003: TUI memory mode vocabulary",
                  slug: "architecture/adr/003-tui-memory-mode-vocabulary",
                },
              ],
            },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Development setup", slug: "development/development" },
            { label: "Testing and verification", slug: "development/testing-and-verification" },
            { label: "CI routing", slug: "development/ci-routing" },
            { label: "Package verification", slug: "development/package-verification" },
            { label: "Release process", slug: "development/release" },
            { label: "Security policy", slug: "development/security" },
            { label: "Documentation architecture", slug: "development/documentation-architecture" },
            { label: "Internal and agent docs", slug: "development/internal-and-agent-docs" },
            {
              label: "Agent docs",
              items: [
                { label: "AGENTS.md", slug: "development/agents-root" },
                { label: "CONTRIBUTING.md", slug: "development/contributing" },
                { label: "CONTEXT.md", slug: "development/context" },
                { label: "Issue tracker", slug: "development/agents/issue-tracker" },
                { label: "Domain docs", slug: "development/agents/domain" },
                { label: "Triage labels", slug: "development/agents/triage-labels" },
              ],
            },
          ],
        },
        {
          label: "Internal / Archive",
          items: [
            { label: "Internal index", slug: "internal" },
            { label: "Architecture TODOs", slug: "internal/architecture-todos" },
            { label: "Next opt-out design", slug: "internal/next-opt-out-design" },
            { label: "Post-MVP roadmap", slug: "internal/post-mvp-roadmap" },
            { label: "PR roadmap", slug: "internal/pr-roadmap" },
            { label: "PRD", slug: "internal/prd" },
            { label: "Coding plan", slug: "internal/coding-plan" },
          ],
        },
      ],
    }),
  ],
});
