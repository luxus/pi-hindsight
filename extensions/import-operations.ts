import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importChatTranscript } from "./import-chat-transcript.js";
import {
  importPiSession,
  importProjectSessions,
  type ImportProgressReporter,
} from "./import-sessions.js";
import { resolveOperationBank } from "./bank-selection.js";

export type ImportOperationDeps = {
  getClient(): HindsightLikeClient;
  getConfig(): ResolvedConfig;
  getProjectBankId(): string;
};

export async function importMemorySession(
  args: {
    sessionFile: string;
    cwd?: string;
    bank?: string;
    dryRun?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  const result = await importPiSession({
    sessionFile: args.sessionFile,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { bankId, ...result };
}

export async function importMemoryChatTranscript(
  args: {
    sourceFile: string;
    cwd: string;
    bank?: string;
    dryRun?: boolean;
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank ?? "global",
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  return importChatTranscript({
    sourceFile: args.sourceFile,
    cwd: args.cwd,
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
}

export async function importMemoryProjectSessions(
  args: {
    cwd: string;
    currentSessionFile?: string;
    searchDir?: string;
    bank?: string;
    dryRun?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  const result = await importProjectSessions({
    cwd: args.cwd,
    ...(args.currentSessionFile ? { currentSessionFile: args.currentSessionFile } : {}),
    ...(args.searchDir ? { searchDir: args.searchDir } : {}),
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { bankId, ...result };
}
