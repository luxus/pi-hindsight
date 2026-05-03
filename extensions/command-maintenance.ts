import { resolve } from "node:path";
import type { CommandOperation } from "./operation-catalog.js";
import type { createMemoryOperations } from "./memory-operation-service.js";
import {
  argList,
  compactText,
  completeFlags,
  firstNonFlagArg,
  sessionFile,
} from "./command-utils.js";

type Operations = ReturnType<typeof createMemoryOperations>;

export function maintenanceCommandOperations(operations: Operations): CommandOperation[] {
  return [
    {
      name: "hindsight:last-recall",
      spec: {
        description: "Show the last opt-in persisted recall snapshot.",
        getArgumentCompletions: (prefix) => completeFlags(prefix, ["--json"]),
        handler: async (args, ctx) => {
          try {
            const result = await operations.lastRecall(ctx.cwd);
            if (!result.snapshot) {
              ctx.ui.notify(
                `No Hindsight recall snapshot at ${result.path}. Enable recall.storeLastRecall to write one.`,
                "warning",
              );
              return;
            }
            if (!Array.isArray(result.snapshot.blocks)) throw new Error("invalid snapshot shape");
            const argsList = argList(args);
            const memoryCount = result.snapshot.blocks.reduce(
              (count, block) => count + block.memoryCount,
              0,
            );
            const banks = result.snapshot.blocks
              .map((block) => `${block.bankId}:${block.memoryCount}`)
              .join(", ");
            const query = compactText(result.snapshot.query, 180);
            if (argsList.includes("--json")) {
              ctx.ui.notify(
                JSON.stringify({ path: result.path, ...result.snapshot }, null, 2),
                "info",
              );
              return;
            }
            ctx.ui.notify(
              `Hindsight last recall ${result.snapshot.createdAt}; memories=${memoryCount}; banks=${banks || "none"}; query=${query}; path=${result.path}; visibility-only, not provider cache`,
              "info",
            );
          } catch (error) {
            ctx.ui.notify(
              `Hindsight last recall snapshot unreadable: ${(error as Error).message}`,
              "warning",
            );
          }
        },
      },
    },
    {
      name: "hindsight:recall-cleanup",
      spec: {
        description:
          "Scan or prune accidentally persisted Hindsight recall blocks from the current session transcript.",
        getArgumentCompletions: (prefix) => completeFlags(prefix, ["--prune"]),
        handler: async (args, ctx) => {
          const argsList = argList(args);
          const explicitFile = firstNonFlagArg(args);
          const activeSessionFile = sessionFile(ctx);
          const current = explicitFile ?? activeSessionFile;
          if (!current) {
            ctx.ui.notify("No session file available.", "warning");
            return;
          }
          const prune = argsList.includes("--prune");
          if (
            prune &&
            (!explicitFile ||
              (activeSessionFile && resolve(explicitFile) === resolve(activeSessionFile)))
          ) {
            ctx.ui.notify(
              "Refusing to prune the active session file. Re-run with /hindsight:recall-cleanup <session.jsonl> --prune after the session is idle.",
              "warning",
            );
            return;
          }
          const result = await operations.recallCleanup(current, prune);
          const message = prune
            ? (() => {
                const pruneResult = result as unknown as { pruned: number; backupPath: string };
                return `Hindsight recall cleanup pruned ${pruneResult.pruned} transcript line${pruneResult.pruned === 1 ? "" : "s"}; backup ${pruneResult.backupPath}`;
              })()
            : `Hindsight recall cleanup found ${result.matchingLines.length} persisted recall line${result.matchingLines.length === 1 ? "" : "s"} in ${result.sessionFile}: ${result.matchingLines.slice(0, 10).join(", ") || "none"}`;
          ctx.ui.notify(message, result.hasMatches ? "warning" : "info");
        },
      },
    },
    {
      name: "hindsight:flush",
      spec: {
        description: "Flush queued retain jobs.",
        handler: async (_args, ctx) => {
          const result = await operations.flush(ctx.cwd);
          ctx.ui.notify(
            `Hindsight flushed ${result.sent}; dead-lettered ${result.deadLettered}; remaining ${result.remaining}`,
            result.remaining || result.deadLettered ? "warning" : "info",
          );
        },
      },
    },
  ];
}
