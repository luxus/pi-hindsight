import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getSessionFile } from "./session.js";
import { formatHindsightStatus, type HindsightActivity } from "./status.js";
import type { ResolvedConfig } from "./types.js";

export type RuntimeCtx = {
  cwd: string;
  ui: {
    setStatus(key: string, text: string | undefined): void;
    notify(message: string, level?: string): void;
  };
  sessionManager?: { getSessionFile?: () => string | undefined };
};

export type RuntimeSnapshot = {
  cwd: string;
  ui: RuntimeCtx["ui"];
  sessionFile?: string;
};

export type ContextEvent = { messages: AgentMessage[] };
export type ContextPatch = { messages: AgentMessage[] };

export function snapshotRuntime(ctx: RuntimeCtx): RuntimeSnapshot | undefined {
  try {
    const cwd = ctx.cwd;
    const ui = ctx.ui;
    const sessionFile = getSessionFile(ctx);
    return { cwd, ui, ...(sessionFile ? { sessionFile } : {}) };
  } catch {
    return undefined;
  }
}

export function setMemoryStatus(args: {
  runtime: RuntimeSnapshot;
  config: ResolvedConfig;
  projectBankId: string;
  activity: HindsightActivity;
  memoryCount?: number;
  queueRemaining?: number;
}): void {
  try {
    args.runtime.ui.setStatus(
      "hindsight",
      formatHindsightStatus(args.config, {
        projectBankId: args.projectBankId,
        cwd: args.runtime.cwd,
        activity: args.activity,
        ...(args.memoryCount !== undefined ? { memoryCount: args.memoryCount } : {}),
        ...(args.queueRemaining !== undefined ? { queueRemaining: args.queueRemaining } : {}),
      }),
    );
  } catch {
    // Session ctx can go stale during replacement/reload; status is best effort.
  }
}

export function notify(runtime: RuntimeSnapshot, message: string, level: string): void {
  try {
    runtime.ui.notify(message, level);
  } catch {
    // Session ctx can go stale during replacement/reload; notifications are best effort.
  }
}
