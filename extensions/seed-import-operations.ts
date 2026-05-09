import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { repoKey } from "./banking.js";
import { resolveOperationBank } from "./bank-selection.js";
import { deliverImportRetain } from "./import-delivery.js";
import { hashImportContent } from "./import-manifest.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

export interface SeedImportPreview {
  sourceFile: string;
  documentId: string;
  contentBytes: number;
  contentHash: string;
  tags: string[];
  wouldWrite: boolean;
  status: "pending" | "queued" | "completed" | "failed";
  queueJobId?: string;
  error?: string;
}

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function assertWithinCwd(cwd: string, path: string): void {
  const relation = relative(cwd, path);
  if (relation.startsWith("..") || isAbsolute(relation))
    throw new Error(`Seed-content import path must stay within cwd: ${path}`);
}

async function collectFiles(paths: string[], cwd: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string) {
    const real = await realpath(path);
    assertWithinCwd(cwd, real);
    const info = await stat(real);
    if (info.isDirectory()) {
      const entries = await readdir(real);
      for (const entry of entries) await visit(resolve(real, entry));
      return;
    }
    if (info.isFile() && SUPPORTED_EXTENSIONS.has(extension(real))) files.push(real);
  }
  for (const path of paths) await visit(resolve(cwd, path));
  return files.sort();
}

function documentId(cwd: string, file: string): string {
  const normalized = relative(cwd, file).split(sep).join("/");
  return `pi-seed-import:${encodeURIComponent(normalized)}`;
}

export function createSeedImportOperations(deps: MemoryOperationsDeps) {
  return {
    async importSeedContent(args: {
      cwd: string;
      paths: string[];
      bank?: string;
      dryRun?: boolean;
      tags?: string[];
    }) {
      if (!args.paths.length) throw new Error("At least one seed-content path is required.");
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const cwd = await realpath(resolve(args.cwd));
      const files = await collectFiles(args.paths, cwd);
      const dryRun = args.dryRun ?? true;
      const tags = [
        "source:pi",
        `repo:${repoKey(cwd)}`,
        "import:seed-content",
        ...(args.tags ?? []),
      ];
      const documents: SeedImportPreview[] = [];
      for (const file of files) {
        const content = await readFile(file, "utf8");
        const preview: SeedImportPreview = {
          sourceFile: relative(cwd, file).split(sep).join("/"),
          documentId: documentId(cwd, file),
          contentBytes: Buffer.byteLength(content, "utf8"),
          contentHash: hashImportContent(content),
          tags,
          wouldWrite: !dryRun,
          status: "pending",
        };
        if (dryRun) {
          documents.push(preview);
          continue;
        }
        try {
          const delivery = await deliverImportRetain({
            cwd,
            config,
            client: deps.getClient(),
            bankId,
            content,
            context: `Pi Hindsight seed-content import from ${preview.sourceFile}`,
            documentId: preview.documentId,
            updateMode: "replace",
            tags,
            metadata: { source: "seed-content-import", source_file: preview.sourceFile },
          });
          documents.push({
            ...preview,
            status: delivery.delivered ? "completed" : "queued",
            queueJobId: delivery.queueJobId,
          });
        } catch (error) {
          documents.push({ ...preview, status: "failed", error: String(error) });
        }
      }
      return { bankId, dryRun, documentCount: documents.length, tags, documents };
    },
  };
}
