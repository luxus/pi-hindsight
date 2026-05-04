import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ImportMode, UpdateMode } from "./types.js";

export type ImportDocumentStatus = "pending" | "queued" | "completed" | "failed" | "skipped";

export interface ImportCheckpointDocument {
  documentId: string;
  leafId: string;
  contentHash: string;
  messageCount: number;
  importMode?: ImportMode;
  projectionVersion?: string;
  importProfile?: string;
  chunkIndex?: number;
  messageRange?: { start: number; end: number };
  status: ImportDocumentStatus;
  updatedAt: string;
  error?: string;
}

export interface ImportCheckpoint {
  version: 1;
  runId: string;
  sourceFile: string;
  bankId: string;
  sessionId: string;
  cwd: string;
  includeBranches: "current-only" | "all-leaves";
  importMode?: ImportMode;
  importProfile?: string;
  updateMode: UpdateMode;
  startedAt: string;
  updatedAt: string;
  documents: Record<string, ImportCheckpointDocument>;
}

export interface ImportCheckpointReadResult {
  checkpoint?: ImportCheckpoint;
  error: string | null;
  action: string | null;
}

export function resolveImportCheckpointPath(cwd: string, checkpointPath: string): string {
  return isAbsolute(checkpointPath) ? checkpointPath : join(cwd, checkpointPath);
}

export function importRunId(args: {
  sourceFile: string;
  bankId: string;
  sessionId: string;
  includeBranches: "current-only" | "all-leaves";
  importMode?: ImportMode;
  updateMode: UpdateMode;
}): string {
  return [
    "pi-import",
    args.bankId,
    args.sessionId,
    args.includeBranches,
    args.importMode ?? "legacy",
    args.updateMode,
    args.sourceFile,
  ]
    .join(":")
    .replace(/\s+/g, "_");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImportCheckpointDocument(value: unknown): value is ImportCheckpointDocument {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.documentId === "string" &&
    typeof value.leafId === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.messageCount === "number" &&
    (value.status === "pending" ||
      value.status === "queued" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "skipped") &&
    typeof value.updatedAt === "string"
  );
}

export async function readImportCheckpoint(path: string): Promise<ImportCheckpoint | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isPlainRecord(parsed)) throw new Error("import checkpoint must be a JSON object");
    const record = parsed as unknown as ImportCheckpoint;
    if (record.documents !== undefined && !isPlainRecord(record.documents)) {
      throw new Error("import checkpoint documents must be a JSON object");
    }
    const documents = record.documents ?? {};
    for (const [documentId, document] of Object.entries(documents)) {
      if (!isImportCheckpointDocument(document) || document.documentId !== documentId) {
        throw new Error(`import checkpoint document ${documentId} is invalid`);
      }
    }
    return { ...record, version: 1, documents };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readImportCheckpointSafe(path: string): Promise<ImportCheckpointReadResult> {
  try {
    const checkpoint = await readImportCheckpoint(path);
    return { ...(checkpoint ? { checkpoint } : {}), error: null, action: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      action: `Move or repair ${path}, then rerun the import command. The next successful import can recreate the checkpoint.`,
    };
  }
}

export async function writeImportCheckpoint(
  path: string,
  checkpoint: ImportCheckpoint,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export function createImportCheckpoint(args: {
  runId: string;
  sourceFile: string;
  bankId: string;
  sessionId: string;
  cwd: string;
  includeBranches: "current-only" | "all-leaves";
  importMode?: ImportMode;
  updateMode: UpdateMode;
  now: string;
}): ImportCheckpoint {
  return {
    version: 1,
    runId: args.runId,
    sourceFile: args.sourceFile,
    bankId: args.bankId,
    sessionId: args.sessionId,
    cwd: args.cwd,
    includeBranches: args.includeBranches,
    ...(args.importMode ? { importMode: args.importMode } : {}),
    updateMode: args.updateMode,
    startedAt: args.now,
    updatedAt: args.now,
    documents: {},
  };
}
