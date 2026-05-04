import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importGatewayTranscript } from "./import-gateway-transcript.js";
import { importPiSession, importProjectSessions } from "./import-sessions.js";
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
  });
  return { bankId, ...result };
}

export async function importMemoryGatewayTranscript(
  args: {
    sourceFile: string;
    cwd: string;
    bank?: string;
    dryRun?: boolean;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank ?? "global",
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  return importGatewayTranscript({
    sourceFile: args.sourceFile,
    cwd: args.cwd,
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
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
  });
  return { bankId, ...result };
}
