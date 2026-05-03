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
        "extensions/config*.ts",
        "extensions/memory-lifecycle*.ts",
        "extensions/client.ts",
      ],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
        "extensions/queue.ts": {
          statements: 80,
          branches: 75,
          functions: 75,
          lines: 80,
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
      },
    },
  },
});
