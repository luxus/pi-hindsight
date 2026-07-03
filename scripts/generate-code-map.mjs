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
    doc: "/pi-hindsight/architecture/lifecycle-and-scope/",
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
    doc: "/pi-hindsight/reference/tools-and-commands/",
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
    title: "Identity and scope",
    doc: "/pi-hindsight/concepts/memory-banks/",
    files: [
      ["extensions/memory-identity.ts", "Derives stable repo/session/document identity."],
      ["extensions/memory-scope.ts", "Selects project/global scopes and tags."],
      ["extensions/observation-scopes.ts", "Defines retain observation-scope vocabulary."],
    ],
  },
  {
    title: "Retain Queue and durable delivery",
    doc: "/pi-hindsight/concepts/queue-durability/",
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
    doc: "/pi-hindsight/guides/importing-sessions/",
    files: [
      [
        "extensions/imports/import-parse.ts",
        "Parses Pi session and chat-transcript JSONL into messages and branches.",
      ],
      [
        "extensions/imports/import-plan.ts",
        "Builds import plans and tracks checkpoint/manifest provenance.",
      ],
      [
        "extensions/imports/import-execute.ts",
        "Curates messages and delivers import retain payloads through the queue.",
      ],
      ["extensions/imports/import-presentation.ts", "Renders import preview and result messages."],
      [
        "extensions/imports/import-sessions.ts",
        "Orchestrates session and chat-transcript imports and exposes the public import API.",
      ],
    ],
  },
  {
    title: "Diagnostics, status, and safety",
    doc: "/pi-hindsight/architecture/diagnostics-and-security/",
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
    doc: "/pi-hindsight/start/setup-tui/",
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
2. Runtime and config modules derive repo/session identity, selected banks, document IDs, and tags.
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
