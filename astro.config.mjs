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
            {
              label: "Core vs companion adapters",
              slug: "architecture/core-vs-companion-adapters",
            },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Documentation architecture", slug: "development/documentation-architecture" },
            { label: "Development", slug: "development/development" },
          ],
        },
      ],
    }),
  ],
});
