import type { CommandOperation } from "./operation-catalog.js";
import type { createMemoryOperations } from "./memory-operation-service.js";
import type { SessionMemoryMode } from "./session-memory-meta.js";
import { completeValues, firstArg, secondArg, sessionFile } from "./command-utils.js";

type Operations = ReturnType<typeof createMemoryOperations>;

function isSessionMode(value: string | undefined): value is SessionMemoryMode {
  return value === "normal" || value === "read-only" || value === "ignored";
}

export function sessionCommandOperations(operations: Operations): CommandOperation[] {
  return [
    {
      name: "hindsight:session",
      spec: {
        description: "Show current Hindsight session memory mode and tags.",
        handler: async (_args, ctx) => {
          const result = await operations.session(ctx.cwd, sessionFile(ctx));
          ctx.ui.notify(
            `Hindsight session mode=${result.meta.mode}; recall=${result.effective.recall}; retain=${result.effective.retain}; nextRetain=${result.meta.nextRetainMode}; tags=${result.meta.tags.join(",") || "none"}`,
            "info",
          );
        },
      },
    },
    {
      name: "hindsight:mode",
      spec: {
        description: "Set session memory mode: normal, read-only, or ignored.",
        getArgumentCompletions: (prefix) =>
          completeValues(prefix, ["normal", "read-only", "ignored"]),
        handler: async (args, ctx) => {
          const mode = firstArg(args);
          if (!isSessionMode(mode)) {
            ctx.ui.notify("Usage: /hindsight:mode normal|read-only|ignored", "warning");
            return;
          }
          const result = await operations.setSessionMode(ctx.cwd, sessionFile(ctx), mode);
          ctx.ui.notify(
            `Hindsight session mode=${result.meta.mode}; recall=${result.effective.recall}; retain=${result.effective.retain}`,
            "info",
          );
        },
      },
    },
    {
      name: "hindsight:next-opt-out",
      spec: {
        description: "Skip automatic retain for the next agent run in this session.",
        handler: async (_args, ctx) => {
          const result = await operations.setNextRetainOff(ctx.cwd, sessionFile(ctx));
          ctx.ui.notify(
            `Hindsight will skip automatic retain for the next agent run in this session. nextRetain=${result.meta.nextRetainMode}`,
            "info",
          );
        },
      },
    },
    {
      name: "hindsight:retain",
      spec: {
        description: "Enable or disable retain for this session.",
        getArgumentCompletions: (prefix) => completeValues(prefix, ["on", "off"]),
        handler: async (args, ctx) => {
          const value = firstArg(args);
          if (value !== "on" && value !== "off") {
            ctx.ui.notify("Usage: /hindsight:retain on|off", "warning");
            return;
          }
          const result = await operations.setSessionRetain(
            ctx.cwd,
            sessionFile(ctx),
            value === "on",
          );
          ctx.ui.notify(
            `Hindsight session retain requested=${value}; effective=${result.effective.retain ? "on" : "off"}; mode=${result.meta.mode}`,
            "info",
          );
        },
      },
    },
    {
      name: "hindsight:tag",
      spec: {
        description: "Add or remove a Hindsight tag for this session.",
        getArgumentCompletions: (prefix) => completeValues(prefix, ["add", "remove"]),
        handler: async (args, ctx) => {
          const action = firstArg(args);
          const tag = secondArg(args);
          if ((action !== "add" && action !== "remove") || !tag) {
            ctx.ui.notify("Usage: /hindsight:tag add|remove <tag>", "warning");
            return;
          }
          const result =
            action === "add"
              ? await operations.addSessionTag(ctx.cwd, sessionFile(ctx), tag)
              : await operations.removeSessionTag(ctx.cwd, sessionFile(ctx), tag);
          ctx.ui.notify(`Hindsight session tags=${result.meta.tags.join(",") || "none"}`, "info");
        },
      },
    },
  ];
}
