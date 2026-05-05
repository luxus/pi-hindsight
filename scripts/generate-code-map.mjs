#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputPath = join(
  process.cwd(),
  "docs-site",
  "src",
  "content",
  "docs",
  "development",
  "code-map.md",
);

const sections = [
  {
    title: "Extension entrypoint and lifecycle",
    doc: "/architecture/lifecycle-and-scope/",
    files: [
      ["extensions/index.ts", "Registers Pi hooks, tools, commands, and setup surface."],
      [
        "extensions/memory-lifecycle.ts",
        "Coordinates session start, context recall, agent-end retain, and shutdown.",
      ],
      [
        "extensions/memory-lifecycle-runtime.ts",
        "Builds per-turn runtime dependencies for lifecycle handlers.",
      ],
      [
        "extensions/memory-lifecycle-recall.ts",
        "Implements ephemeral recall injection for the context hook.",
      ],
      ["extensions/memory-lifecycle-retain.ts", "Builds sanitized retain deltas at agent end."],
    ],
  },
  {
    title: "Operation service and explicit surface",
    doc: "/reference/tools-and-commands/",
    files: [
      [
        "extensions/memory-operation-service.ts",
        "Shared service used by tools, commands, setup, and maintenance intents.",
      ],
      ["extensions/operation-catalog.ts", "Registry for command/tool operation metadata."],
      ["extensions/tools.ts", "Registers explicit Hindsight tools."],
      ["extensions/commands.ts", "Registers slash commands and command dispatch."],
      ["extensions/tool-presenters.ts", "Formats explicit tool responses."],
    ],
  },
  {
    title: "Identity, scope, and routing",
    doc: "/concepts/memory-banks/",
    files: [
      ["extensions/memory-identity.ts", "Derives stable repo/session/document identity."],
      ["extensions/memory-scope.ts", "Selects project/global scopes and tags."],
      ["extensions/memory-router.ts", "Routes memory behavior by mode and operation."],
      ["extensions/routing-strategy.ts", "Keeps routing policy behind an explicit strategy seam."],
      ["extensions/observation-scopes.ts", "Defines retain observation-scope vocabulary."],
    ],
  },
  {
    title: "Retain Queue and durable delivery",
    doc: "/concepts/queue-durability/",
    files: [
      ["extensions/retain-queue.ts", "Queues retain jobs before delivery."],
      ["extensions/queue.ts", "Queue record helpers and public queue operations."],
      ["extensions/jsonl-queue-store.ts", "JSONL-backed active/dead-letter queue storage."],
      ["extensions/queue-lock.ts", "Cross-process queue lock coordination."],
      ["extensions/queue-delivery.ts", "Flushes queued jobs to Hindsight."],
      ["extensions/retain-job-builder.ts", "Builds structured retain jobs from messages."],
      ["extensions/retain-cursor.ts", "Persists already-retained transcript cursor state."],
    ],
  },
  {
    title: "Historical import",
    doc: "/guides/importing-sessions/",
    files: [
      ["extensions/import-sessions.ts", "Imports Pi session JSONL history."],
      ["extensions/import-gateway-transcript.ts", "Imports gateway/chat transcript JSONL."],
      ["extensions/import-parser.ts", "Projects raw session records into importable messages."],
      ["extensions/import-plan.ts", "Builds preview and execution plans."],
      ["extensions/import-execution.ts", "Runs import plans."],
      ["extensions/import-retain.ts", "Transforms import batches into Hindsight retain calls."],
      ["extensions/import-checkpoint.ts", "Tracks deterministic import progress."],
      ["extensions/import-manifest.ts", "Records import provenance."],
    ],
  },
  {
    title: "Diagnostics, status, and safety",
    doc: "/architecture/diagnostics-and-security/",
    files: [
      ["extensions/diagnostics.ts", "Collects doctor/diagnostic results."],
      ["extensions/status.ts", "Builds user-facing status summaries."],
      ["extensions/status-health.ts", "Classifies health of config/client/queue surfaces."],
      ["extensions/sanitize.ts", "Redacts secrets before retain or display."],
      ["extensions/client.ts", "Hindsight client adapter boundary."],
      ["extensions/client-rest.ts", "REST transport implementation."],
    ],
  },
  {
    title: "Configuration and setup TUI",
    doc: "/start/setup-tui/",
    files: [
      ["extensions/config.ts", "Loads and resolves extension config."],
      ["extensions/config-normalize.ts", "Normalizes config defaults and legacy shapes."],
      ["extensions/config-writer.ts", "Writes config updates."],
      ["extensions/config-editing-registry.ts", "Defines editable config fields."],
      ["extensions/guided-setup.ts", "Runs setup intent flow."],
      ["extensions/setup-tui.ts", "Implements setup TUI screens."],
      ["extensions/setup-tui-actions.ts", "Applies setup TUI actions."],
      ["extensions/setup-tui-render.ts", "Renders setup TUI state."],
    ],
  },
];

const missingFiles = sections
  .flatMap((section) => section.files.map(([file]) => file))
  .filter((file) => !existsSync(join(process.cwd(), file)));

const content = `---
title: Code map
---

# Code map

> Derived navigation, not authoritative product documentation.
>
> This page is generated by \`npm run code-map\` from a curated, deterministic module list in \`scripts/generate-code-map.mjs\`. It is meant to help maintainers find code paths. Hand-authored docs, ADRs, tests, and Hindsight/Pi official docs remain the source of truth.

## Refresh or disable

Refresh the map after moving major modules:

\`\`\`bash
npm run code-map
\`\`\`

Check generated output and the docs site:

\`\`\`bash
npm run code-map:check
npm run docs:check
\`\`\`

Disable by removing this page from \`astro.config.mjs\` navigation and excluding \`npm run code-map:check\` from \`docs:check\`. Do that only in a focused PR that explains why the map is no longer useful.

${sections
  .map(
    (section) => `## ${section.title}

Related hand-authored docs: [${section.title}](${section.doc})

${section.files.map(([file, role]) => `- \`${file}\` — ${role}`).join("\n")}`,
  )
  .join("\n\n")}

## Data-flow sketch

1. Pi calls the extension entrypoint and lifecycle hooks.
2. Runtime and config modules derive repo/session identity, selected banks, document IDs, tags, and routing policy.
3. The context hook performs Recall and injects an ephemeral Recall Block.
4. Agent-end retain builds a sanitized structured delta and enqueues a Retain Job before delivery.
5. Queue delivery flushes jobs to Hindsight through the client adapter; failures remain durable for replay.
6. Explicit tools and commands use the operation service so user-triggered recall, retain, reflect, import, diagnostics, and setup behavior share policy.

## Boundaries

- No secrets, local absolute paths, raw retained payloads, or queue contents are included.
- No network or AI service is required to generate or build this page.
- File roles are intentionally short and stable; implementation details belong in tests, source, and hand-authored design docs.
`;

if (process.argv.includes("--check")) {
  const current = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(outputPath, "utf8"),
  );
  if (current !== content) {
    console.error("docs-site code map is stale. Run npm run code-map.");
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, content);
}
