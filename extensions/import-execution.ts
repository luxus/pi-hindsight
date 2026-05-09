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
import { readImportManifestSafe, upsertImportManifestEntries } from "./import-manifest.js";
import {
  type ImportDocumentPreview,
  type ImportRetainResult,
  isImportRetainQueuedError,
  previewImportBranch,
  retainImportBranch,
} from "./import-retain.js";
import { redactError } from "./sanitize.js";
import type { ImportPlan } from "./import-plan.js";
import { removeQueuedRetains } from "./retain-queue.js";
import { importRetainJobMatchesIdentity } from "./import-queue-identity.js";
import type { ImportProgressReporter } from "./import-sessions.js";

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
    ...(args.document.skipReason ? { skipReason: args.document.skipReason } : {}),
    updatedAt: args.updatedAt,
    ...(args.error ? { error: args.error } : {}),
  };
}

export async function executeImportPlan(args: {
  client: HindsightLikeClient;
  parsed: ParsedSession;
  plan: ImportPlan;
  dryRun?: boolean;
  onProgress?: ImportProgressReporter;
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
    args.onProgress?.({
      phase: "previewing",
      message: `Projecting branch ${branch.leafId}`,
      sessionFile,
    });
    const previews = previewImportBranch(common);
    for (const [index, preview] of previews.entries()) {
      args.onProgress?.({
        phase: args.dryRun ? "previewing" : "retaining",
        message: `${args.dryRun ? "Previewing" : "Importing"} document ${index + 1}/${previews.length} for branch ${branch.leafId}`,
        sessionFile,
        current: index + 1,
        total: previews.length,
      });
      const previous = checkpoint.documents[preview.document.documentId];
      const canSkip =
        !args.dryRun &&
        importConfig.import.resume &&
        previous?.status === "completed" &&
        previous.contentHash === preview.document.contentHash;
      if (args.dryRun || canSkip) {
        if (canSkip && previous)
          await removeQueuedRetains(cwd, importConfig, (job) =>
            importRetainJobMatchesIdentity(job, {
              bankId,
              documentId: preview.document.documentId,
              updateMode,
              sourceFile: sessionFile,
              cwd,
              sessionId,
              leafId: previous.leafId,
              includeBranches,
              ...(previous.importMode ? { importMode: previous.importMode } : {}),
              ...(previous.toolResults ? { toolResults: previous.toolResults } : {}),
              ...(previous.importQualityProfile
                ? { importQualityProfile: previous.importQualityProfile }
                : {}),
              ...(previous.projectionVersion
                ? { projectionVersion: previous.projectionVersion }
                : {}),
              ...(previous.importProfile ? { importProfile: previous.importProfile } : {}),
              ...(previous.chunkIndex !== undefined ? { chunkIndex: previous.chunkIndex } : {}),
              ...(previous.messageRange ? { messageRange: previous.messageRange } : {}),
              contentHash: previous.contentHash,
            }),
          );
        results.push({
          ...preview,
          document: {
            ...preview.document,
            wouldWrite: false,
            status: canSkip ? ("skipped" as const) : preview.document.status,
            ...(canSkip ? { skipReason: "already-imported" as const } : {}),
          },
        });
        continue;
      }

      if (preview.document.status === "skipped") {
        const skippedAt = new Date().toISOString();
        checkpoint.documents[preview.document.documentId] = checkpointDocument({
          document: preview.document,
          status: "skipped",
          toolResults: importConfig.import.toolResults,
          updatedAt: skippedAt,
        });
        checkpoint.updatedAt = skippedAt;
        await writeImportCheckpoint(checkpointPath, checkpoint);
        results.push({
          ...preview,
          document: { ...preview.document, wouldWrite: false, status: "skipped" as const },
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

      let completed: ImportRetainResult | undefined;
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
        completed = retained;
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
      if (!completed) throw new Error("Import retain completed without result.");
      await upsertImportManifestEntries(manifestPath, [completed.manifestEntry]);
      results.push({
        ...completed,
        document: { ...completed.document, status: "completed" as const },
      });
    }
  }

  const skippedResults = results.filter((result) => result.document.status === "skipped");
  if (!args.dryRun && skippedResults.length > 0) {
    const manifest = (await readImportManifestSafe(manifestPath)).manifest;
    const missingSkippedEntries = skippedResults
      .filter((result) => result.document.skipReason !== "empty-curated-projection")
      .filter((result) => !manifest.imports[result.document.documentId])
      .map((result) => result.manifestEntry);
    if (missingSkippedEntries.length > 0)
      await upsertImportManifestEntries(manifestPath, missingSkippedEntries);
  }

  const documents = results.map((result) => result.document);
  return {
    documents,
    messageCount: documents.reduce((count, document) => count + document.messageCount, 0),
    retained: !args.dryRun,
  };
}
