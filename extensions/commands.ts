import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { MemoryOperationsDeps } from "./memory-operations.js";
import { createMemoryOperations } from "./memory-operations.js";
import { runHindsightSetupTui } from "./setup-tui.js";
import type { SessionMemoryMode } from "./session-memory-meta.js";

function firstArg(args: unknown): string | undefined {
  if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : undefined;
  if (typeof args === "string") return args.split(/\s+/).filter(Boolean)[0];
  return undefined;
}

function firstNonFlagArg(args: unknown): string | undefined {
  return argList(args).find((arg) => !arg.startsWith("--"));
}

function secondArg(args: unknown): string | undefined {
  if (Array.isArray(args)) return typeof args[1] === "string" ? args[1] : undefined;
  if (typeof args === "string") return args.split(/\s+/).filter(Boolean)[1];
  return undefined;
}

function argList(args: unknown): string[] {
  if (Array.isArray(args)) return args.filter((arg): arg is string => typeof arg === "string");
  if (typeof args === "string") return args.split(/\s+/).filter(Boolean);
  return [];
}

function sessionFile(ctx: {
  sessionManager?: { getSessionFile?: () => string | undefined };
}): string | undefined {
  return ctx.sessionManager?.getSessionFile?.();
}

function isSessionMode(value: string | undefined): value is SessionMemoryMode {
  return value === "normal" || value === "read-only" || value === "ignored";
}

function importOptions(args: unknown): {
  dryRun: boolean;
  includeBranches?: "all-leaves";
} {
  const flags = new Set(argList(args));
  return {
    dryRun: flags.has("--dry-run") || flags.has("--preview"),
    ...(flags.has("--all-leaves") ? { includeBranches: "all-leaves" as const } : {}),
  };
}

function importDocumentSummary(result: { documents: { updateMode: string; status: string }[] }) {
  const modes = [...new Set(result.documents.map((document) => document.updateMode))].join(",");
  const statuses = [...new Set(result.documents.map((document) => document.status))].join(",");
  return `documents=${result.documents.length}; update=${modes || "n/a"}; status=${statuses || "n/a"}`;
}

function queueIssueSummary(queue?: {
  active?: { error?: string | null; malformed?: number };
  deadLetter?: { error?: string | null; valid?: number; malformed?: number };
}): string {
  if (!queue) return "";
  const issues = [
    queue.active?.error ? `queue unreadable: ${queue.active.error}` : "",
    queue.deadLetter?.error ? `dead-letter unreadable: ${queue.deadLetter.error}` : "",
    queue.active?.malformed ? `queue malformed=${queue.active.malformed}` : "",
    queue.deadLetter?.valid ? `dead-letter=${queue.deadLetter.valid}` : "",
    queue.deadLetter?.malformed ? `dead-letter malformed=${queue.deadLetter.malformed}` : "",
  ].filter(Boolean);
  return issues.length ? `; ${issues.join("; ")}` : "";
}

function hasQueueIssue(queue?: {
  active?: { error?: string | null; malformed?: number };
  deadLetter?: { error?: string | null; valid?: number; malformed?: number };
}): boolean {
  return Boolean(
    queue?.active?.error ||
    queue?.deadLetter?.error ||
    queue?.active?.malformed ||
    queue?.deadLetter?.valid ||
    queue?.deadLetter?.malformed,
  );
}

export function registerCommands(pi: ExtensionAPI, deps: MemoryOperationsDeps) {
  const operations = createMemoryOperations(deps);

  pi.registerCommand("hindsight:status", {
    description: "Show Hindsight extension status.",
    handler: async (args, ctx) => {
      const status = await operations.status(ctx.cwd);
      const bank = status.config.banks.project.enabled
        ? status.bankId
        : (status.config.banks.global.bankId ?? "none");
      const profile = status.config.banks.project.enabled
        ? status.config.banks.global.enabled
          ? "project+global"
          : "project-only"
        : "global-only";
      const queueIssue = queueIssueSummary(status.queue);
      ctx.ui.notify(
        `Hindsight ${status.config.enabled ? "on" : "off"}; profile ${profile}; bank ${bank}; queue ${status.queueLength}; imports ${status.imports.count}${queueIssue}`,
        hasQueueIssue(status.queue) ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("hindsight:doctor", {
    description: "Check Hindsight connectivity and queue.",
    handler: async (args, ctx) => {
      const doctor = await operations.doctor(ctx.cwd);
      const append = doctor.capabilities
        ? doctor.capabilities.appendUpdateMode
          ? "append supported"
          : "append unsupported"
        : "append not checked";
      const observation = doctor.observations.error
        ? `; observations invalid: ${doctor.observations.error}`
        : "";
      const queueIssue = queueIssueSummary(doctor.queue);
      ctx.ui.notify(
        `Hindsight ${doctor.health.ok ? "reachable" : `unreachable: ${doctor.health.error}`}; ${append}; queue ${doctor.queueLength}; imports ${doctor.imports.count}${observation}${queueIssue}`,
        doctor.health.ok &&
          doctor.capabilities?.appendUpdateMode !== false &&
          !doctor.observations.error &&
          !hasQueueIssue(doctor.queue)
          ? "info"
          : "warning",
      );
    },
  });

  pi.registerCommand("hindsight:config", {
    description: "Show effective Hindsight config.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify(operations.config(), null, 2), "info");
    },
  });

  pi.registerCommand("hindsight:debug", {
    description: "Show detailed Hindsight diagnostics.",
    handler: async (_args, ctx) => {
      const debug = await operations.debug(ctx);
      ctx.ui.notify(debug.report, debug.health.ok ? "info" : "warning");
    },
  });

  pi.registerCommand("hindsight:setup", {
    description: "Open interactive Hindsight configuration TUI.",
    handler: async (_args, ctx) => {
      await runHindsightSetupTui(ctx, deps);
    },
  });

  pi.registerCommand("hindsight:init", {
    description: "Write .pi/hindsight.json with the currently selected project bank.",
    handler: async (_args, ctx) => {
      const result = await operations.init(ctx.cwd);
      ctx.ui.notify(
        `Wrote ${result.path}; project bank ${result.projectBankId}. Run /hindsight:debug to verify.`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:import", {
    description: "Import the current Pi session JSONL into Hindsight.",
    handler: async (args, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile?.();
      if (!sessionFile) {
        ctx.ui.notify(
          "No session file available; use hindsight_import tool with sessionFile.",
          "warning",
        );
        return;
      }
      const result = await operations.importSession({
        sessionFile,
        ...importOptions(args),
      });
      ctx.ui.notify(
        result.dryRun
          ? `Import preview: messages=${result.messageCount}; ${importDocumentSummary(result)}; write=no; checkpoint=${result.checkpointPath}; manifest unchanged=${result.manifestPath}`
          : `Imported messages=${result.messageCount}; ${importDocumentSummary(result)}; first=${result.documentId}; manifest=${result.manifestPath}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:import-current", {
    description: "Import the current Pi session JSONL into Hindsight.",
    handler: async (args, ctx) => {
      const current = sessionFile(ctx);
      if (!current) {
        ctx.ui.notify("No current session file available.", "warning");
        return;
      }
      const result = await operations.importSession({
        sessionFile: current,
        ...importOptions(args),
      });
      ctx.ui.notify(
        result.dryRun
          ? `Import preview: current session; messages=${result.messageCount}; ${importDocumentSummary(result)}; write=no; checkpoint=${result.checkpointPath}; manifest unchanged=${result.manifestPath}`
          : `Imported current session; messages=${result.messageCount}; ${importDocumentSummary(result)}; first=${result.documentId}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:import-file", {
    description: "Import an explicit Pi session JSONL file into Hindsight.",
    handler: async (args, ctx) => {
      const file = firstNonFlagArg(args);
      if (!file) {
        ctx.ui.notify("Usage: /hindsight:import-file <path> [--dry-run] [--all-leaves]", "warning");
        return;
      }
      const result = await operations.importSession({ sessionFile: file, ...importOptions(args) });
      ctx.ui.notify(
        result.dryRun
          ? `Import preview: file=${file}; messages=${result.messageCount}; ${importDocumentSummary(result)}; write=no; checkpoint=${result.checkpointPath}; manifest unchanged=${result.manifestPath}`
          : `Imported file=${file}; messages=${result.messageCount}; ${importDocumentSummary(result)}; first=${result.documentId}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:import-project-sessions", {
    description: "Import Pi session JSONL files scoped to the current repo/cwd.",
    handler: async (args, ctx) => {
      const current = sessionFile(ctx);
      const result = await operations.importProjectSessions({
        cwd: ctx.cwd,
        ...(current ? { currentSessionFile: current } : {}),
        ...importOptions(args),
      });
      ctx.ui.notify(
        result.dryRun
          ? `Project import preview: sessions=${result.sessionFiles.length}/${result.scanned}; documents=${result.documentCount}; messages=${result.messageCount}; write=no`
          : `Imported project sessions: sessions=${result.sessionFiles.length}/${result.scanned}; documents=${result.documentCount}; messages=${result.messageCount}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:session", {
    description: "Show current Hindsight session memory mode and tags.",
    handler: async (_args, ctx) => {
      const result = await operations.session(ctx.cwd, sessionFile(ctx));
      ctx.ui.notify(
        `Hindsight session mode=${result.meta.mode}; recall=${result.effective.recall}; retain=${result.effective.retain}; tags=${result.meta.tags.join(",") || "none"}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:mode", {
    description: "Set session memory mode: normal, read-only, or ignored.",
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
  });

  pi.registerCommand("hindsight:retain", {
    description: "Enable or disable retain for this session.",
    handler: async (args, ctx) => {
      const value = firstArg(args);
      if (value !== "on" && value !== "off") {
        ctx.ui.notify("Usage: /hindsight:retain on|off", "warning");
        return;
      }
      const result = await operations.setSessionRetain(ctx.cwd, sessionFile(ctx), value === "on");
      ctx.ui.notify(
        `Hindsight session retain requested=${value}; effective=${result.effective.retain ? "on" : "off"}; mode=${result.meta.mode}`,
        "info",
      );
    },
  });

  pi.registerCommand("hindsight:tag", {
    description: "Add or remove a Hindsight tag for this session.",
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
  });

  pi.registerCommand("hindsight:last-recall", {
    description: "Show the last opt-in persisted recall snapshot.",
    handler: async (_args, ctx) => {
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
        const memoryCount = result.snapshot.blocks.reduce(
          (count, block) => count + block.memoryCount,
          0,
        );
        ctx.ui.notify(
          `Hindsight last recall ${result.snapshot.createdAt}; memories=${memoryCount}; query=${result.snapshot.query}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `Hindsight last recall snapshot unreadable: ${(error as Error).message}`,
          "warning",
        );
      }
    },
  });

  pi.registerCommand("hindsight:recall-cleanup", {
    description:
      "Scan or prune accidentally persisted Hindsight recall blocks from the current session transcript.",
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
  });

  pi.registerCommand("hindsight:flush", {
    description: "Flush queued retain jobs.",
    handler: async (_args, ctx) => {
      const result = await operations.flush(ctx.cwd);
      ctx.ui.notify(
        `Hindsight flushed ${result.sent}; dead-lettered ${result.deadLettered}; remaining ${result.remaining}`,
        result.remaining || result.deadLettered ? "warning" : "info",
      );
    },
  });
}
