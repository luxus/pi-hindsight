import type { ImportMode, ImportQualityProfile, ResolvedConfig, UpdateMode } from "../types.js";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { stableSessionId } from "../utils/session.js";
import {
  type ImportBranch,
  leafIds,
  type ParsedSession,
  selectImportBranches,
} from "./import-parse.js";

type ImportToolResults = ResolvedConfig["import"]["toolResults"];

export type ImportDocumentStatus = "pending" | "queued" | "completed" | "failed" | "skipped";

export interface ImportCheckpointDocument {
  documentId: string;
  leafId: string;
  contentHash: string;
  messageCount: number;
  importMode?: ImportMode;
  toolResults?: ImportToolResults;
  importQualityProfile?: ImportQualityProfile;
  projectionVersion?: string;
  importProfile?: string;
  chunkIndex?: number;
  messageRange?: { start: number; end: number };
  status: ImportDocumentStatus;
  skipReason?: "already-imported" | "empty-curated-projection";
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
  toolResults?: ImportToolResults;
  importQualityProfile?: ImportQualityProfile;
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

function isImportMode(value: unknown): value is ImportMode {
  return value === "curated" || value === "raw" || value === "forensic";
}

function isImportToolResults(value: unknown): value is ImportToolResults {
  return value === "errors-only" || value === "summary" || value === "content";
}

function isImportQualityProfile(value: unknown): value is ImportQualityProfile {
  return value === "compatible" || value === "strict";
}

function isUpdateMode(value: unknown): value is UpdateMode {
  return value === "append" || value === "replace";
}

function isSkipReason(value: unknown): value is ImportCheckpointDocument["skipReason"] {
  return value === "already-imported" || value === "empty-curated-projection";
}

function isMessageRange(value: unknown): value is { start: number; end: number } {
  return isPlainRecord(value) && typeof value.start === "number" && typeof value.end === "number";
}

function hasValidCheckpointRunFields(value: Record<string, unknown>): boolean {
  return (
    (value.includeBranches === undefined ||
      value.includeBranches === "current-only" ||
      value.includeBranches === "all-leaves") &&
    (value.importMode === undefined || isImportMode(value.importMode)) &&
    (value.toolResults === undefined || isImportToolResults(value.toolResults)) &&
    (value.importQualityProfile === undefined ||
      isImportQualityProfile(value.importQualityProfile)) &&
    (value.updateMode === undefined || isUpdateMode(value.updateMode))
  );
}

function isImportCheckpointDocument(value: unknown): value is ImportCheckpointDocument {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.documentId === "string" &&
    typeof value.leafId === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.messageCount === "number" &&
    (value.importMode === undefined || isImportMode(value.importMode)) &&
    (value.toolResults === undefined || isImportToolResults(value.toolResults)) &&
    (value.importQualityProfile === undefined ||
      isImportQualityProfile(value.importQualityProfile)) &&
    (value.projectionVersion === undefined || typeof value.projectionVersion === "string") &&
    (value.importProfile === undefined || typeof value.importProfile === "string") &&
    (value.chunkIndex === undefined || typeof value.chunkIndex === "number") &&
    (value.messageRange === undefined || isMessageRange(value.messageRange)) &&
    (value.status === "pending" ||
      value.status === "queued" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "skipped") &&
    (value.skipReason === undefined || isSkipReason(value.skipReason)) &&
    typeof value.updatedAt === "string" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

export async function readImportCheckpoint(path: string): Promise<ImportCheckpoint | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isPlainRecord(parsed)) throw new Error("import checkpoint must be a JSON object");
    if (!hasValidCheckpointRunFields(parsed)) {
      throw new Error("import checkpoint run fields are invalid");
    }
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
      action: `Move or repair ${path}, then open /hindsight and press i to re-run import. The next successful import can recreate the checkpoint.`,
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
  toolResults?: ImportToolResults;
  importQualityProfile?: ImportQualityProfile;
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
    ...(args.toolResults ? { toolResults: args.toolResults } : {}),
    ...(args.importQualityProfile ? { importQualityProfile: args.importQualityProfile } : {}),
    updateMode: args.updateMode,
    startedAt: args.now,
    updatedAt: args.now,
    documents: {},
  };
}

export interface ImportManifestEntry {
  documentId: string;
  bankId: string;
  sourceFile: string;
  importedAt: string;
  contentHash: string;
  messageCount: number;
  leafId: string;
  sessionId: string;
  cwd: string;
  includeBranches: "current-only" | "all-leaves";
  importMode?: ImportMode;
  toolResults?: "errors-only" | "summary" | "content";
  importQualityProfile?: ImportQualityProfile;
  projectionVersion?: string;
  importProfile?: string;
  chunkIndex?: number;
  messageRange?: { start: number; end: number };
  updateMode: UpdateMode;
}

export interface ImportManifest {
  version: 1;
  imports: Record<string, ImportManifestEntry>;
}

export interface ImportManifestReadResult {
  manifest: ImportManifest;
  error: string | null;
  action: string | null;
}

export function resolveImportManifestPath(cwd: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? manifestPath : join(cwd, manifestPath);
}

export function hashImportContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isImportManifestEntry(value: unknown): value is ImportManifestEntry {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.documentId === "string" &&
    typeof value.bankId === "string" &&
    typeof value.sourceFile === "string" &&
    typeof value.importedAt === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.messageCount === "number" &&
    typeof value.leafId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.cwd === "string" &&
    (value.includeBranches === "current-only" || value.includeBranches === "all-leaves") &&
    (value.importMode === undefined ||
      value.importMode === "curated" ||
      value.importMode === "raw" ||
      value.importMode === "forensic") &&
    (value.toolResults === undefined ||
      value.toolResults === "errors-only" ||
      value.toolResults === "summary" ||
      value.toolResults === "content") &&
    (value.importQualityProfile === undefined ||
      value.importQualityProfile === "compatible" ||
      value.importQualityProfile === "strict") &&
    (value.updateMode === "append" || value.updateMode === "replace")
  );
}

export async function readImportManifest(path: string): Promise<ImportManifest> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isPlainRecord(parsed)) throw new Error("manifest must be a JSON object");
    const record = parsed as Partial<ImportManifest>;
    if (record.imports !== undefined && !isPlainRecord(record.imports)) {
      throw new Error("manifest imports must be a JSON object");
    }
    const imports = record.imports ?? {};
    for (const [documentId, entry] of Object.entries(imports)) {
      if (!isImportManifestEntry(entry) || entry.documentId !== documentId) {
        throw new Error(`manifest import entry ${documentId} is invalid`);
      }
    }
    return { version: 1, imports };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, imports: {} };
    throw error;
  }
}

export async function readImportManifestSafe(path: string): Promise<ImportManifestReadResult> {
  try {
    return { manifest: await readImportManifest(path), error: null, action: null };
  } catch (error) {
    return {
      manifest: { version: 1, imports: {} },
      error: error instanceof Error ? error.message : String(error),
      action: `Move or repair ${path}, then open /hindsight and press i to re-run import. New successful imports will recreate the manifest.`,
    };
  }
}

export async function writeImportManifest(path: string, manifest: ImportManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function upsertImportManifestEntries(
  path: string,
  entries: ImportManifestEntry[],
): Promise<ImportManifest> {
  const manifest = (await readImportManifestSafe(path)).manifest;
  for (const entry of entries) manifest.imports[entry.documentId] = entry;
  await writeImportManifest(path, manifest);
  return manifest;
}

export function importManifestSummary(manifest: ImportManifest): {
  count: number;
  latest?: ImportManifestEntry;
} {
  const entries = Object.values(manifest.imports).sort((a, b) =>
    b.importedAt.localeCompare(a.importedAt),
  );
  return { count: entries.length, ...(entries[0] ? { latest: entries[0] } : {}) };
}

export interface ImportPlan {
  sessionFile: string;
  bankId: string;
  cwd: string;
  sessionId: string;
  leaves: string[];
  includeBranches: ResolvedConfig["import"]["includeBranches"];
  branches: ImportBranch[];
  manifestPath: string;
  checkpointPath: string;
  updateMode: "append" | "replace";
  runId: string;
  importConfig: ResolvedConfig;
}

function sameCwd(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return resolve(left) === resolve(right);
}

export function buildImportPlan(args: {
  sessionFile: string;
  parsed: ParsedSession;
  bankId: string;
  config: ResolvedConfig;
  cwd?: string;
  requireMatchingCwd?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
}): ImportPlan {
  if (args.cwd && args.requireMatchingCwd && !args.parsed.cwd) {
    throw new Error(
      `Refusing to import session without cwd; current cwd is ${args.cwd}. Use explicit file import for unscoped sessions.`,
    );
  }
  if (args.cwd && args.parsed.cwd && !sameCwd(args.parsed.cwd, args.cwd)) {
    throw new Error(
      `Refusing to import session from cwd ${args.parsed.cwd}; current cwd is ${args.cwd}. Use project-scoped import from the matching repo.`,
    );
  }
  const cwd = resolve(args.cwd ?? args.parsed.cwd ?? dirname(args.sessionFile));
  const sessionId = args.parsed.sessionId ?? stableSessionId(args.sessionFile, cwd);
  const leaves = leafIds(args.parsed.messages);
  const includeBranches = args.includeBranches ?? args.config.import.includeBranches;
  const branches = selectImportBranches(args.parsed, includeBranches);
  const manifestPath = resolveImportManifestPath(cwd, args.config.import.manifestPath);
  const checkpointPath = resolveImportCheckpointPath(cwd, args.config.import.checkpointPath);
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
  const runId = importRunId({
    sourceFile: args.sessionFile,
    bankId: args.bankId,
    sessionId,
    includeBranches,
    importMode: args.config.import.mode,
    updateMode,
  });
  return {
    sessionFile: args.sessionFile,
    bankId: args.bankId,
    cwd,
    sessionId,
    leaves,
    includeBranches,
    branches,
    manifestPath,
    checkpointPath,
    updateMode,
    runId,
    importConfig: { ...args.config, import: { ...args.config.import, includeBranches } },
  };
}
