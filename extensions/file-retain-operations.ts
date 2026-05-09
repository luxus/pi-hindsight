import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { resolveOperationBank } from "./bank-selection.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { redactSecrets } from "./sanitize.js";
import type { RetainFileMetadata } from "./types.js";

function unsupported(name: string): Error {
  return new Error(`Hindsight client does not support ${name}.`);
}

function bankFor(deps: MemoryOperationsDeps, bank: string | undefined): string {
  return resolveOperationBank({
    requestedBank: bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
}

function assertWithinCwd(cwd: string, path: string): void {
  const relation = relative(cwd, path);
  if (relation.startsWith("..") || isAbsolute(relation))
    throw new Error(`File retain path must stay within cwd: ${path}`);
}

export interface FileRetainInput {
  path: string;
  context?: string;
  documentId?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

function fileMetadata(file: FileRetainInput): RetainFileMetadata {
  return {
    ...(file.context ? { context: file.context } : {}),
    ...(file.documentId ? { documentId: file.documentId } : {}),
    ...(file.tags ? { tags: file.tags } : {}),
    ...(file.metadata ? { metadata: file.metadata } : {}),
  };
}

export function createFileRetainOperations(deps: MemoryOperationsDeps) {
  return {
    async retainFiles(args: {
      cwd: string;
      bank?: string;
      files: FileRetainInput[];
      context?: string;
      tags?: string[];
      metadata?: Record<string, string>;
    }) {
      if (!args.files.length) throw new Error("At least one file is required.");
      if (args.files.length > 10)
        throw new Error("Hindsight file retain supports at most 10 files.");
      const bankId = bankFor(deps, args.bank);
      const config = deps.getConfig();
      const cwd = await realpath(resolve(args.cwd));
      const client = deps.getClient();
      if (!client.retainFiles) throw unsupported("retainFiles");
      const blobs: Blob[] = [];
      for (const file of args.files) {
        const path = await realpath(resolve(cwd, file.path));
        assertWithinCwd(cwd, path);
        const bytes = await readFile(path);
        blobs.push(new File([bytes], basename(path)));
      }
      const clean = (value: string) => (config.retain.redactSecrets ? redactSecrets(value) : value);
      const cleanMetadata = (metadata: Record<string, string> | undefined) =>
        metadata
          ? Object.fromEntries(
              Object.entries(metadata).map(([key, value]) => [
                key,
                config.retain.redactSecrets &&
                /(?:api[_-]?key|token|secret|password|authorization)/i.test(key)
                  ? "[REDACTED]"
                  : clean(value),
              ]),
            )
          : undefined;
      const filesMetadata: RetainFileMetadata[] = args.files.map((file) => {
        const metadata =
          args.metadata || file.metadata
            ? cleanMetadata(Object.assign({}, args.metadata, file.metadata))
            : undefined;
        return {
          ...fileMetadata(file),
          ...(file.context
            ? { context: clean(file.context) }
            : args.context
              ? { context: clean(args.context) }
              : {}),
          ...(args.tags ? { tags: [...(args.tags ?? []), ...(file.tags ?? [])] } : {}),
          ...(metadata ? { metadata } : {}),
        };
      });
      const result = await client.retainFiles(bankId, blobs, {
        ...(args.context ? { context: clean(args.context) } : {}),
        filesMetadata,
      });
      return { bankId, fileCount: args.files.length, result };
    },
  };
}
