import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ImportMode, UpdateMode } from "./types.js";

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      action: `Move or repair ${path}, then rerun the import command. New successful imports will recreate the manifest.`,
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
