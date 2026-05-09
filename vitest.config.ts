import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "extensions/queue.ts",
        "extensions/queue-lock.ts",
        "extensions/jsonl-queue-store.ts",
        "extensions/import-*.ts",
        "extensions/config*.ts",
        "extensions/memory-lifecycle*.ts",
        "extensions/client.ts",
        "extensions/client-rest.ts",
        "extensions/timeout.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
        "extensions/queue.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "extensions/queue-lock.ts": {
          statements: 85,
          branches: 80,
          functions: 100,
          lines: 85,
        },
        "extensions/jsonl-queue-store.ts": {
          statements: 90,
          branches: 85,
          functions: 100,
          lines: 90,
        },
        "extensions/import-checkpoint.ts": {
          statements: 95,
          branches: 80,
          functions: 100,
          lines: 95,
        },
        "extensions/import-delivery.ts": {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "extensions/import-execution.ts": {
          statements: 95,
          branches: 80,
          functions: 100,
          lines: 95,
        },
        "extensions/import-chat-transcript.ts": {
          statements: 90,
          branches: 70,
          functions: 100,
          lines: 90,
        },
        "extensions/import-manifest.ts": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        "extensions/import-parser.ts": {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        "extensions/import-retain.ts": {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "extensions/import-sessions.ts": {
          statements: 90,
          branches: 70,
          functions: 100,
          lines: 90,
        },
        "extensions/config.ts": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
        "extensions/client.ts": {
          statements: 65,
          branches: 60,
          functions: 55,
          lines: 65,
        },
        "extensions/client-rest.ts": {
          statements: 70,
          branches: 65,
          functions: 70,
          lines: 70,
        },
        "extensions/timeout.ts": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
