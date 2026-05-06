import type { HindsightLikeClient } from "./types.js";
import type { ParsedSession } from "./import-parser.js";
import {
  createImportCheckpoint,
  readImportCheckpointSafe,
  writeImportCheckpoint,
  type ImportCheckpoint,
  type ImportCheckpointDocument,
  type ImportDocumentStatus,
} from "./import-checkpoint.js";
import { upsertImportManifestEntries } from "./import-manifest.js";
import {
  type ImportDocumentPreview,
  isImportRetainQueuedError,
  previewImportBranch,
  retainImportBranch,
} from "./import-retain.js";
import { redactError } from "./sanitize.js";
import type { ImportPlan } from "./import-plan.js";

export interface ImportSessionDocumentResult extends ImportDocumentPreview {}

export interface ImportExecutionResult {
  documents: ImportSessionDocumentResult[];
  messageCount: number;
  retained: boolean;
}

function checkpointDocument(args: {
  document: ImportDocumentPreview;
  status: ImportDocumentStatus;
  toolResults: ImportPlan["importConfig"]["import"]["toolResults"];
  updatedAt: string;
  error?: string;
}): ImportCheckpointDocument {
  return {
    documentId: args.document.documentId,
    leafId: args.document.leafId,
    contentHash: args.document.contentHash,
    messageCount: args.document.messageCount,
    ...(args.document.importMode ? { importMode: args.document.importMode } : {}),
    toolResults: args.toolResults,
    ...(args.document.importQualityProfile
      ? { importQualityProfile: args.document.importQualityProfile }
      : {}),
    ...(args.document.projectionVersion
      ? { projectionVersion: args.document.projectionVersion }
      : {}),
    ...(args.document.importProfile ? { importProfile: args.document.importProfile } : {}),
    ...(args.document.chunkIndex !== undefined ? { chunkIndex: args.document.chunkIndex } : {}),
    ...(args.document.messageRange ? { messageRange: args.document.messageRange } : {}),
    status: args.status,
    updatedAt: args.updatedAt,
    ...(args.error ? { error: args.error } : {}),
  };
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
          toolResults: importConfig.import.toolResults,
          importQualityProfile: importConfig.import.qualityProfile,
          updateMode,
          now,
        });
  checkpoint = {
    ...checkpoint,
    updatedAt: now,
    toolResults: importConfig.import.toolResults,
    importQualityProfile: importConfig.import.qualityProfile,
  };

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

      checkpoint.documents[preview.document.documentId] = checkpointDocument({
        document: preview.document,
        status: "pending",
        toolResults: importConfig.import.toolResults,
        updatedAt: new Date().toISOString(),
      });
      await writeImportCheckpoint(checkpointPath, checkpoint);

      try {
        const retained = await retainImportBranch({
          ...common,
          client: args.client,
          documentId: preview.document.documentId,
        });
        const completedAt = new Date().toISOString();
        checkpoint.documents[retained.document.documentId] = checkpointDocument({
          document: retained.document,
          status: "completed",
          toolResults: importConfig.import.toolResults,
          updatedAt: completedAt,
        });
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
        checkpoint.documents[preview.document.documentId] = checkpointDocument({
          document: preview.document,
          status,
          toolResults: importConfig.import.toolResults,
          updatedAt: failedAt,
          error: message,
        });
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
