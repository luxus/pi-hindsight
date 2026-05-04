import type { HindsightLikeClient } from "./types.js";
import type { ParsedSession } from "./import-parser.js";
import {
  createImportCheckpoint,
  readImportCheckpointSafe,
  writeImportCheckpoint,
  type ImportCheckpoint,
} from "./import-checkpoint.js";
import { upsertImportManifestEntries } from "./import-manifest.js";
import {
  isImportRetainQueuedError,
  previewImportBranch,
  retainImportBranch,
} from "./import-retain.js";
import { redactError } from "./sanitize.js";
import type { ImportPlan } from "./import-plan.js";

export interface ImportSessionDocumentResult {
  documentId: string;
  leafId: string;
  messageCount: number;
  importMode?: "curated" | "raw" | "forensic";
  projectionVersion?: string;
  importProfile?: string;
  chunkIndex?: number;
  messageRange?: { start: number; end: number };
  contentHash: string;
  contentBytes: number;
  tags: string[];
  updateMode: "append" | "replace";
  bankId: string;
  wouldWrite: boolean;
  status: "pending" | "queued" | "completed" | "failed" | "skipped";
  error?: string;
}

export interface ImportExecutionResult {
  documents: ImportSessionDocumentResult[];
  messageCount: number;
  retained: boolean;
}

export async function executeImportPlan(args: {
  client: HindsightLikeClient;
  parsed: ParsedSession;
  plan: ImportPlan;
  dryRun?: boolean;
}): Promise<ImportExecutionResult> {
  const {
    sessionFile,
    bankId,
    cwd,
    sessionId,
    leaves,
    includeBranches,
    branches,
    manifestPath,
    checkpointPath,
    updateMode,
    runId,
    importConfig,
  } = args.plan;
  const now = new Date().toISOString();
  const existingCheckpoint = importConfig.import.resume
    ? (await readImportCheckpointSafe(checkpointPath)).checkpoint
    : undefined;
  let checkpoint: ImportCheckpoint =
    existingCheckpoint?.runId === runId
      ? existingCheckpoint
      : createImportCheckpoint({
          runId,
          sourceFile: sessionFile,
          bankId,
          sessionId,
          cwd,
          includeBranches,
          importMode: importConfig.import.mode,
          updateMode,
          now,
        });
  checkpoint = { ...checkpoint, updatedAt: now };

  const results = [];
  for (const branch of branches) {
    const common = {
      sessionFile,
      bankId,
      config: importConfig,
      parsed: args.parsed,
      cwd,
      sessionId,
      leaves,
      branch,
    };
    const previews = previewImportBranch(common);
    for (const preview of previews) {
      const previous = checkpoint.documents[preview.document.documentId];
      const canSkip =
        !args.dryRun &&
        importConfig.import.resume &&
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
        ...(preview.document.importMode ? { importMode: preview.document.importMode } : {}),
        ...(preview.document.projectionVersion
          ? { projectionVersion: preview.document.projectionVersion }
          : {}),
        ...(preview.document.importProfile
          ? { importProfile: preview.document.importProfile }
          : {}),
        ...(preview.document.chunkIndex !== undefined
          ? { chunkIndex: preview.document.chunkIndex }
          : {}),
        ...(preview.document.messageRange ? { messageRange: preview.document.messageRange } : {}),
        status: "pending",
        updatedAt: new Date().toISOString(),
      };
      await writeImportCheckpoint(checkpointPath, checkpoint);

      try {
        const retained = await retainImportBranch({
          ...common,
          client: args.client,
          documentId: preview.document.documentId,
        });
        const completedAt = new Date().toISOString();
        checkpoint.documents[retained.document.documentId] = {
          documentId: retained.document.documentId,
          leafId: retained.document.leafId,
          contentHash: retained.document.contentHash,
          messageCount: retained.document.messageCount,
          ...(retained.document.importMode ? { importMode: retained.document.importMode } : {}),
          ...(retained.document.projectionVersion
            ? { projectionVersion: retained.document.projectionVersion }
            : {}),
          ...(retained.document.importProfile
            ? { importProfile: retained.document.importProfile }
            : {}),
          ...(retained.document.chunkIndex !== undefined
            ? { chunkIndex: retained.document.chunkIndex }
            : {}),
          ...(retained.document.messageRange
            ? { messageRange: retained.document.messageRange }
            : {}),
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
        const status = isImportRetainQueuedError(error) ? "queued" : "failed";
        checkpoint.documents[preview.document.documentId] = {
          documentId: preview.document.documentId,
          leafId: preview.document.leafId,
          contentHash: preview.document.contentHash,
          messageCount: preview.document.messageCount,
          ...(preview.document.importMode ? { importMode: preview.document.importMode } : {}),
          ...(preview.document.projectionVersion
            ? { projectionVersion: preview.document.projectionVersion }
            : {}),
          ...(preview.document.importProfile
            ? { importProfile: preview.document.importProfile }
            : {}),
          ...(preview.document.chunkIndex !== undefined
            ? { chunkIndex: preview.document.chunkIndex }
            : {}),
          ...(preview.document.messageRange ? { messageRange: preview.document.messageRange } : {}),
          status,
          updatedAt: failedAt,
          error: message,
        };
        checkpoint.updatedAt = failedAt;
        await writeImportCheckpoint(checkpointPath, checkpoint);
        results.push({
          ...preview,
          document: { ...preview.document, status, error: message },
        });
        throw error;
      }
    }
  }

  const completedResults = results.filter(
    (result) => result.document.status === "completed" || result.document.status === "skipped",
  );
  if (!args.dryRun && completedResults.length > 0) {
    await upsertImportManifestEntries(
      manifestPath,
      completedResults.map((result) => result.manifestEntry),
    );
  }

  const documents = results.map((result) => result.document);
  return {
    documents,
    messageCount: documents.reduce((count, document) => count + document.messageCount, 0),
    retained: !args.dryRun,
  };
}
