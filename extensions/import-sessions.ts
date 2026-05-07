import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importDocumentId } from "./session.js";
import { parseImportSessionJsonl, parsePiSessionJsonl } from "./import-parser.js";
import { selectImportBranches } from "./import-branches.js";
import { hashImportContent } from "./import-manifest.js";
import { buildImportPlan } from "./import-plan.js";
import { executeImportPlan, type ImportSessionDocumentResult } from "./import-execution.js";

export { parseImportSessionJsonl, parsePiSessionJsonl } from "./import-parser.js";
export { selectImportBranches } from "./import-branches.js";
export type { ImportBranch } from "./import-branches.js";
export type { ParsedMessage, ParsedSession } from "./import-parser.js";
export type { ImportSessionDocumentResult } from "./import-execution.js";

function sameProjectCwd(sessionCwd: string | undefined, cwd: string): boolean {
  if (!sessionCwd) return false;
  return resolve(sessionCwd) === resolve(cwd);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function projectSessionCheckpointPath(basePath: string, sessionFile: string): string {
  return `${basePath}.${hashImportContent(sessionFile).slice(0, 12)}.json`;
}

export async function discoverProjectSessionFiles(args: {
  cwd: string;
  currentSessionFile?: string;
  searchDir?: string;
}): Promise<ProjectSessionDiscoveryResult> {
  const searchDir =
    args.searchDir ?? (args.currentSessionFile ? dirname(args.currentSessionFile) : undefined);
  if (!searchDir) return { sessionFiles: [], scanned: 0 };
  const entries = await readdir(searchDir);
  const candidates = entries
    .filter((entry) => extname(entry) === ".jsonl")
    .map((entry) => join(searchDir, entry));
  const sessionFiles: string[] = [];
  let scanned = 0;
  for (const candidate of candidates) {
    if (!(await isFile(candidate))) continue;
    scanned += 1;
    try {
      const parsed = parseImportSessionJsonl(await readFile(candidate, "utf8"));
      if (sameProjectCwd(parsed.cwd, args.cwd)) sessionFiles.push(candidate);
    } catch {
      // Ignore unrelated or malformed JSONL files during project-scoped discovery.
    }
  }
  return { sessionFiles: sessionFiles.sort(), scanned };
}

export interface ProjectSessionDiscoveryResult {
  sessionFiles: string[];
  scanned: number;
}

export interface ImportProjectSessionsResult {
  sessionFiles: string[];
  scanned: number;
  imported: ImportSessionResult[];
  messageCount: number;
  documentCount: number;
  dryRun: boolean;
  malformedLineCount: number;
}

export interface ImportSessionResult {
  sessionFile: string;
  documentId: string;
  messageCount: number;
  retained: boolean;
  dryRun: boolean;
  manifestPath: string;
  checkpointPath: string;
  runId: string;
  malformedLineCount: number;
  documents: ImportSessionDocumentResult[];
}

export async function importPiSession(args: {
  sessionFile: string;
  cwd?: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  requireMatchingCwd?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
}): Promise<ImportSessionResult> {
  const text = await readFile(args.sessionFile, "utf8");
  const parsed = parseImportSessionJsonl(text);
  const plan = buildImportPlan({
    sessionFile: args.sessionFile,
    parsed,
    bankId: args.bankId,
    config: args.config,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.requireMatchingCwd !== undefined
      ? { requireMatchingCwd: args.requireMatchingCwd }
      : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
  });
  const execution = await executeImportPlan({
    client: args.client,
    parsed,
    plan,
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
  });

  const first = execution.documents[0] ?? {
    documentId: importDocumentId(plan.sessionId, "root"),
  };
  return {
    sessionFile: args.sessionFile,
    documentId: first.documentId,
    messageCount: execution.messageCount,
    retained: execution.retained,
    dryRun: Boolean(args.dryRun),
    manifestPath: plan.manifestPath,
    checkpointPath: plan.checkpointPath,
    runId: plan.runId,
    malformedLineCount: parsed.malformedLineCount,
    documents: execution.documents,
  };
}

export async function importProjectSessions(args: {
  cwd: string;
  currentSessionFile?: string;
  searchDir?: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
}): Promise<ImportProjectSessionsResult> {
  const discovery = await discoverProjectSessionFiles({
    cwd: args.cwd,
    ...(args.currentSessionFile ? { currentSessionFile: args.currentSessionFile } : {}),
    ...(args.searchDir ? { searchDir: args.searchDir } : {}),
  });
  const imported: ImportSessionResult[] = [];
  for (const sessionFile of discovery.sessionFiles) {
    imported.push(
      await importPiSession({
        sessionFile,
        cwd: args.cwd,
        requireMatchingCwd: true,
        bankId: args.bankId,
        client: args.client,
        config: {
          ...args.config,
          import: {
            ...args.config.import,
            checkpointPath: projectSessionCheckpointPath(
              args.config.import.checkpointPath,
              sessionFile,
            ),
          },
        },
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
      }),
    );
  }
  return {
    sessionFiles: discovery.sessionFiles,
    scanned: discovery.scanned,
    imported,
    messageCount: imported.reduce((count, result) => count + result.messageCount, 0),
    documentCount: imported.reduce((count, result) => count + result.documents.length, 0),
    dryRun: Boolean(args.dryRun),
    malformedLineCount: imported.reduce((count, result) => count + result.malformedLineCount, 0),
  };
}
