import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AgentUseProfile } from "../types.js";

const EPHEMERAL_PROCESS_SESSION_ID = randomUUID();

export function stableSessionId(sessionFile: string | undefined, cwd: string): string {
  const basis = sessionFile || `ephemeral:${cwd}:${EPHEMERAL_PROCESS_SESSION_ID}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function liveDocumentId(sessionFile: string | undefined, cwd: string): string {
  return `pi-session:${stableSessionId(sessionFile, cwd)}`;
}

export function importDocumentId(sessionId: string, leafId: string): string {
  return `pi-import:${sessionId}:leaf:${leafId}`;
}

export function explicitMemoryDocumentId(args: {
  cwd: string;
  sessionFile?: string;
  bankId: string;
  content: string;
  context: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ bankId: args.bankId, content: args.content, context: args.context }))
    .digest("hex")
    .slice(0, 16);
  return `pi-explicit:${stableSessionId(args.sessionFile, args.cwd)}:${digest}`;
}

export function contextLabel(
  cwd: string,
  sessionFile: string | undefined,
  agentUse: AgentUseProfile = "coding",
): string {
  const suffix = sessionFile ? `, session ${basename(sessionFile)}` : ", ephemeral session";
  if (agentUse === "conversation") {
    return `Pi conversation/task session for "${basename(cwd)}"${suffix}`;
  }
  return `Pi coding session for repo "${basename(cwd)}"${suffix}`;
}

export function getSessionFile(ctx: {
  sessionManager?: { getSessionFile?: () => string | undefined };
}): string | undefined {
  return ctx.sessionManager?.getSessionFile?.();
}
