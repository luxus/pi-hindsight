import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import starlight from "@astrojs/starlight";
import starlightLLMButton from "starlight-llm-button";

export default defineConfig({
  site: "https://luxus.github.io/pi-hindsight",
  base: "/pi-hindsight",
  srcDir: "./docs-site/src",
  outDir: "./docs-site/dist",
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        flowchart: {
          curve: "basis",
        },
      },
    }),
    starlight({
      title: "Pi Hindsight",
      disable404Route: true,
      plugins: [
        starlightLLMButton({
          customText: {
            copy: "Copy page for LLM",
            copied: "Copied page markdown",
            error: "Could not copy page markdown",
          },
          preCopyPrompt:
            "Use this Pi Hindsight documentation page as source context. Preserve technical terms and cite page headings when useful.\n\n",
        }),
      ],
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
            { label: "Project identity and scope tags", slug: "concepts/project-identity" },
            { label: "Retain, Recall, and Reflect", slug: "concepts/retain-recall-reflect" },
            {
              label: "Document IDs and update modes",
              slug: "concepts/document-ids-update-modes",
            },
            { label: "Retain Queue durability", slug: "concepts/queue-durability" },
            { label: "Session memory modes", slug: "concepts/session-memory-modes" },
            { label: "Historical Import", slug: "concepts/imports" },
            { label: "Memory behavior", slug: "concepts/memory-behavior" },
            { label: "Hindsight core functions", slug: "concepts/hindsight-core-functions" },
            {
              label: "Starter mental model suggestions",
              slug: "concepts/starter-mental-model-suggestions",
            },
            {
              label: "Coding memory evaluation",
              slug: "concepts/coding-memory-evaluation",
            },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Configure memory profiles", slug: "guides/configure-memory-profiles" },
            { label: "Use /hindsight status", slug: "guides/use-hindsight-status" },
            { label: "Importing sessions", slug: "guides/importing-sessions" },
            { label: "Inspect recalls and receipts", slug: "guides/inspect-recalls-and-receipts" },
            { label: "Recover Retain Queue", slug: "guides/recover-retain-queue" },
            { label: "Run local smoke test", slug: "guides/run-local-smoke-test" },
            { label: "MCP multi-client bank wiring", slug: "guides/mcp-multi-client" },
            { label: "Upgrading to domain banks", slug: "guides/upgrading-to-domain-banks" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Compatibility matrix", slug: "reference/compatibility" },
            { label: "Tools and commands", slug: "reference/tools-and-commands" },
            { label: "Hooks", slug: "reference/hooks" },
            { label: "Memory modes", slug: "reference/memory-modes" },
            { label: "Import controls", slug: "reference/import-controls" },
            { label: "Hindsight API links", slug: "reference/hindsight-api-links" },
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
                {
                  label: "ADR 004: lifeOS dual-bank design",
                  slug: "architecture/adr/004-lifeos-dual-bank-design",
                },
                {
                  label: "ADR 005: Domain banks and agent-first surface",
                  slug: "architecture/adr/005-domain-banks-and-agent-first-surface",
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
            { label: "Docs site publishing", slug: "development/docs-site-publishing" },
            { label: "Code map", slug: "development/code-map" },
            { label: "Internal and agent docs", slug: "development/internal-and-agent-docs" },
            {
              label: "Maintainer archive",
              items: [
                { label: "Internal index", slug: "internal" },
                { label: "Architecture TODOs", slug: "internal/architecture-todos" },
                { label: "Next opt-out design", slug: "internal/next-opt-out-design" },
                { label: "PRD", slug: "internal/prd" },
              ],
            },
            {
              label: "Agent docs",
              items: [
                { label: "AGENTS.md", slug: "development/agents-root" },
                { label: "CONTRIBUTING.md", slug: "development/contributing" },
                { label: "CONTEXT.md", slug: "development/context" },
                { label: "Issue tracker", slug: "development/agents/issue-tracker" },
                { label: "Domain docs", slug: "development/agents/domain" },
                { label: "Triage labels", slug: "development/agents/triage-labels" },
                { label: "PR shepherd", slug: "development/agents/pr-shepherd-workflow" },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
