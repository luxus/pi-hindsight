import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importDocumentId, stableSessionId } from "./session.js";
import { parseImportSessionJsonl, parsePiSessionJsonl } from "./import-parser.js";
import { leafIds, selectImportBranches } from "./import-branches.js";
import {
  createImportCheckpoint,
  importRunId,
  readImportCheckpoint,
  resolveImportCheckpointPath,
  writeImportCheckpoint,
  type ImportCheckpoint,
} from "./import-checkpoint.js";
import {
  hashImportContent,
  resolveImportManifestPath,
  upsertImportManifestEntries,
} from "./import-manifest.js";
import { previewImportBranch, retainImportBranch } from "./import-retain.js";
import { redactError } from "./sanitize.js";

export { parseImportSessionJsonl, parsePiSessionJsonl } from "./import-parser.js";
export { selectImportBranches } from "./import-branches.js";
export type { ImportBranch } from "./import-branches.js";
export type { ParsedMessage, ParsedSession } from "./import-parser.js";

function sameProjectCwd(sessionCwd: string | undefined, cwd: string): boolean {
  if (!sessionCwd) return false;
  return sessionCwd === cwd;
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
}

export interface ImportSessionDocumentResult {
  documentId: string;
  leafId: string;
  messageCount: number;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  updateMode: "append" | "replace";
  bankId: string;
  wouldWrite: boolean;
  status: "pending" | "completed" | "failed" | "skipped";
  error?: string;
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
  documents: ImportSessionDocumentResult[];
}

export async function importPiSession(args: {
  sessionFile: string;
  cwd?: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
}): Promise<ImportSessionResult> {
  const text = await readFile(args.sessionFile, "utf8");
  const parsed = parseImportSessionJsonl(text);
  if (args.cwd && parsed.cwd && parsed.cwd !== args.cwd) {
    throw new Error(
      `Refusing to import session from cwd ${parsed.cwd}; current cwd is ${args.cwd}. Use project-scoped import from the matching repo.`,
    );
  }
  const cwd = args.cwd ?? parsed.cwd ?? dirname(args.sessionFile);
  const sessionId = parsed.sessionId ?? stableSessionId(args.sessionFile, cwd);
  const leaves = leafIds(parsed.messages);
  const includeBranches = args.includeBranches ?? args.config.import.includeBranches;
  const branches = selectImportBranches(parsed, includeBranches);
  const manifestPath = resolveImportManifestPath(cwd, args.config.import.manifestPath);
  const checkpointPath = resolveImportCheckpointPath(cwd, args.config.import.checkpointPath);
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
  const runId = importRunId({
    sourceFile: args.sessionFile,
    bankId: args.bankId,
    sessionId,
    includeBranches,
    updateMode,
  });

  const importConfig = { ...args.config, import: { ...args.config.import, includeBranches } };
  const now = new Date().toISOString();
  const existingCheckpoint = args.config.import.resume
    ? await readImportCheckpoint(checkpointPath)
    : undefined;
  let checkpoint: ImportCheckpoint =
    existingCheckpoint?.runId === runId
      ? existingCheckpoint
      : createImportCheckpoint({
          runId,
          sourceFile: args.sessionFile,
          bankId: args.bankId,
          sessionId,
          cwd,
          includeBranches,
          updateMode,
          now,
        });
  checkpoint = { ...checkpoint, updatedAt: now };

  const results = [];
  for (const branch of branches) {
    const common = {
      sessionFile: args.sessionFile,
      bankId: args.bankId,
      config: importConfig,
      parsed,
      cwd,
      sessionId,
      leaves,
      branch,
    };
    const preview = previewImportBranch(common);
    const previous = checkpoint.documents[preview.document.documentId];
    const canSkip =
      !args.dryRun &&
      args.config.import.resume &&
      previous?.status === "completed" &&
      previous.contentHash === preview.document.contentHash;
    if (args.dryRun || canSkip) {
      results.push({
        ...preview,
        document: {
          ...preview.document,
          wouldWrite: false,
          status: canSkip ? ("skipped" as const) : preview.document.status,
        },
      });
      continue;
    }

    checkpoint.documents[preview.document.documentId] = {
      documentId: preview.document.documentId,
      leafId: preview.document.leafId,
      contentHash: preview.document.contentHash,
      messageCount: preview.document.messageCount,
      status: "pending",
      updatedAt: new Date().toISOString(),
    };
    await writeImportCheckpoint(checkpointPath, checkpoint);

    try {
      const retained = await retainImportBranch({ ...common, client: args.client });
      const completedAt = new Date().toISOString();
      checkpoint.documents[retained.document.documentId] = {
        documentId: retained.document.documentId,
        leafId: retained.document.leafId,
        contentHash: retained.document.contentHash,
        messageCount: retained.document.messageCount,
        status: "completed",
        updatedAt: completedAt,
      };
      checkpoint.updatedAt = completedAt;
      await writeImportCheckpoint(checkpointPath, checkpoint);
      results.push({
        ...retained,
        document: { ...retained.document, status: "completed" as const },
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = redactError(error);
      checkpoint.documents[preview.document.documentId] = {
        documentId: preview.document.documentId,
        leafId: preview.document.leafId,
        contentHash: preview.document.contentHash,
        messageCount: preview.document.messageCount,
        status: "failed",
        updatedAt: failedAt,
        error: message,
      };
      checkpoint.updatedAt = failedAt;
      await writeImportCheckpoint(checkpointPath, checkpoint);
      results.push({
        ...preview,
        document: { ...preview.document, status: "failed" as const, error: message },
      });
      throw error;
    }
  }

  const documents = results.map((result) => result.document);
  const completedResults = results.filter(
    (result) => result.document.status === "completed" || result.document.status === "skipped",
  );
  if (!args.dryRun && completedResults.length > 0) {
    await upsertImportManifestEntries(
      manifestPath,
      completedResults.map((result) => result.manifestEntry),
    );
  }

  const first = documents[0] ?? {
    documentId: importDocumentId(sessionId, "root"),
    leafId: "root",
    messageCount: 0,
    contentHash: "",
    contentBytes: 0,
    tags: [],
    updateMode: args.config.import.replaceExistingImportedDocs ? "replace" : "append",
    bankId: args.bankId,
    wouldWrite: !args.dryRun,
    status: "pending" as const,
  };
  return {
    sessionFile: args.sessionFile,
    documentId: first.documentId,
    messageCount: documents.reduce((count, document) => count + document.messageCount, 0),
    retained: !args.dryRun,
    dryRun: Boolean(args.dryRun),
    manifestPath,
    checkpointPath,
    runId,
    documents,
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
  };
}
