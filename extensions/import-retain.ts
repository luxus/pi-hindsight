import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importDocumentId, stableSessionId } from "./session.js";
import { baseTags } from "./banking.js";
import { redactSecrets } from "./sanitize.js";
import { hashImportContent, type ImportManifestEntry } from "./import-manifest.js";
import { createMemoryIdentity } from "./memory-identity.js";
import { isInjectedHindsightMemory } from "./messages.js";
import { expandObservationScopes } from "./observation-scopes.js";
import type { ImportBranch } from "./import-branches.js";
import type { ParsedSession } from "./import-parser.js";
import { deliverImportRetain } from "./import-delivery.js";
import {
  buildCuratedImportProjection,
  importByteLength,
  stableProjectionMessage,
} from "./import-curation-policy.js";

export interface ImportRetainArgs {
  sessionFile: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  parsed: ParsedSession;
  cwd: string;
  sessionId: string;
  leaves: string[];
  branch: ImportBranch;
}

export interface ImportDocumentPreview {
  documentId: string;
  leafId: string;
  messageCount: number;
  rawMessageCount?: number;
  projectedMessageCount?: number;
  rawBytes?: number;
  projectedBytes?: number;
  droppedToolResultCount?: number;
  droppedToolResultBytes?: number;
  droppedTools?: Array<{ name: string; count: number; bytes: number }>;
  topDroppedTools?: Array<{ name: string; count: number; bytes: number }>;
  keptToolErrorCount?: number;
  keptToolErrorBytes?: number;
  classificationReasonCounts?: Record<string, number>;
  estimatedDocumentCount?: number;
  estimatedChunkCount?: number;
  importMode?: ResolvedConfig["import"]["mode"];
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

export interface ImportRetainResult {
  document: ImportDocumentPreview;
  manifestEntry: ImportManifestEntry;
}

export class ImportRetainQueuedError extends Error {
  readonly code = "IMPORT_RETAIN_QUEUED";

  constructor(message: string) {
    super(message);
    this.name = "ImportRetainQueuedError";
  }
}

export function isImportRetainQueuedError(error: unknown): error is ImportRetainQueuedError {
  return error instanceof ImportRetainQueuedError;
}

interface ImportBranchBuildResult extends ImportRetainResult {
  content: string;
  context: string;
  observationScopes: string[][];
}

function resolvedParentSessionId(parsed: ParsedSession, cwd: string): string | undefined {
  return (
    parsed.parentSessionId ??
    (parsed.parentSessionFile ? stableSessionId(parsed.parentSessionFile, cwd) : undefined)
  );
}

const CURATED_PROJECTION_VERSION = "curated-turns-v1";

interface ImportChunk {
  index: number;
  messages: Array<{ message: ImportBranch["messages"][number]; originalIndex: number }>;
  start: number;
  end: number;
}

function chunkCuratedMessages(
  messages: ImportBranch["messages"],
  config: ResolvedConfig,
): ImportChunk[] {
  const indexed = messages.map((message, originalIndex) => ({ message, originalIndex }));
  const turns: ImportChunk[] = [];
  let current: ImportChunk["messages"] = [];
  for (const entry of indexed) {
    if (entry.message.data.role === "user" && current.length) {
      turns.push({
        index: turns.length,
        messages: current,
        start: current[0]!.originalIndex,
        end: current.at(-1)!.originalIndex,
      });
      current = [];
    }
    current.push(entry);
  }
  if (current.length)
    turns.push({
      index: turns.length,
      messages: current,
      start: current[0]!.originalIndex,
      end: current.at(-1)!.originalIndex,
    });
  const chunks: ImportChunk[] = [];
  let chunk: ImportChunk["messages"] = [];
  let turnCount = 0;
  const flush = () => {
    if (!chunk.length) return;
    chunks.push({
      index: chunks.length,
      messages: chunk,
      start: chunk[0]!.originalIndex,
      end: chunk.at(-1)!.originalIndex,
    });
    chunk = [];
    turnCount = 0;
  };
  for (const turn of turns) {
    const nextMessages = [...chunk, ...turn.messages];
    const wouldOverflowTurns = turnCount >= config.import.turnsPerDocument;
    const wouldOverflowBytes =
      chunk.length > 0 &&
      importByteLength(nextMessages.map((entry) => entry.message.data)) >
        config.import.maxDocumentBytes;
    if (wouldOverflowTurns || wouldOverflowBytes) flush();
    chunk.push(...turn.messages);
    turnCount += 1;
  }
  flush();
  return chunks.length ? chunks : [{ index: 0, messages: [], start: 0, end: 0 }];
}

function curatedImportProfile(config: ResolvedConfig): string {
  return `turns-${config.import.turnsPerDocument}-bytes-${config.import.maxDocumentBytes}`;
}

function importChunkDocumentId(args: {
  sessionId: string;
  leafId: string;
  mode: ResolvedConfig["import"]["mode"];
  profile?: string;
  chunk?: ImportChunk;
}): string {
  if (args.mode !== "curated" || !args.chunk || !args.profile)
    return importDocumentId(args.sessionId, args.leafId);
  return `${importDocumentId(args.sessionId, args.leafId)}:${args.profile}:${CURATED_PROJECTION_VERSION}:chunk-${args.chunk.index}-${args.chunk.start}-${args.chunk.end}`;
}

function buildImportBranch(args: Omit<ImportRetainArgs, "client">): ImportBranchBuildResult[] {
  const leafId = args.branch.leafId;
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  const mode = args.config.import.mode;
  const branchMessages =
    mode === "forensic"
      ? args.branch.messages
      : args.branch.messages.filter((message) => !isInjectedHindsightMemory(message.data));
  const chunks =
    mode === "curated"
      ? chunkCuratedMessages(branchMessages, args.config)
      : [
          {
            index: 0,
            messages: branchMessages.map((message, originalIndex) => ({ message, originalIndex })),
            start: 0,
            end: Math.max(0, branchMessages.length - 1),
          },
        ];
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
  const identity = createMemoryIdentity(args.cwd, args.config, args.sessionFile);
  const observationScopes = args.config.observations.enabled
    ? expandObservationScopes(args.config.observations.scopes, {
        ...identity,
        sessionId: args.sessionId,
        projectBankId: args.bankId,
      })
    : [];

  return chunks.map((chunk) => {
    const chunkMessages = chunk.messages.map((entry) => entry.message);
    const projection =
      mode === "curated"
        ? buildCuratedImportProjection(chunkMessages, args.config)
        : {
            messages: chunkMessages.map((message) => stableProjectionMessage(message.data)),
            rawBytes: chunkMessages.reduce(
              (total, message) => total + importByteLength(message.data),
              0,
            ),
            projectedBytes: importByteLength(chunkMessages.map((message) => message.data)),
            droppedToolResultCount: 0,
            droppedToolResultBytes: 0,
            droppedTools: [],
            topDroppedTools: [],
            keptToolErrorCount: chunkMessages.filter(
              (message) => message.data.role === "toolResult" && message.data.isError === true,
            ).length,
            keptToolErrorBytes: chunkMessages
              .filter(
                (message) => message.data.role === "toolResult" && message.data.isError === true,
              )
              .reduce((total, message) => total + importByteLength(message.data), 0),
            estimatedChunkCount: Math.max(
              1,
              Math.ceil(importByteLength(chunkMessages.map((message) => message.data)) / 8_000),
            ),
          };
    const importProfile = mode === "curated" ? curatedImportProfile(args.config) : undefined;
    const documentId = importChunkDocumentId({
      sessionId: args.sessionId,
      leafId,
      mode,
      ...(importProfile ? { profile: importProfile } : {}),
      chunk,
    });
    const projectionVersion = mode === "curated" ? CURATED_PROJECTION_VERSION : undefined;
    const messageRange = { start: chunk.start, end: chunk.end };
    const contentRaw = JSON.stringify(
      {
        source: "pi-session-import",
        sessionFile: args.sessionFile,
        cwd: args.parsed.cwd,
        sessionId: args.sessionId,
        ...(parentSessionId ? { parentSessionId } : {}),
        ...(args.parsed.parentSessionFile
          ? { parentSessionFile: args.parsed.parentSessionFile }
          : {}),
        branchLeafId: leafId,
        projection:
          mode === "curated"
            ? projectionVersion
            : mode === "forensic"
              ? "forensic-raw-v1"
              : "raw-v1",
        ...(mode === "curated" ? { chunkIndex: chunk.index, messageRange } : {}),
        projectedMessageCount: projection.messages.length,
        messages:
          mode === "curated" ? projection.messages : chunkMessages.map((message) => message.data),
      },
      null,
      2,
    );
    const content = args.config.retain.redactSecrets ? redactSecrets(contentRaw) : contentRaw;
    const contentHash = hashImportContent(content);
    const tags = [
      ...baseTags(args.cwd, args.sessionId, leafId),
      "import:historical",
      "imported:true",
      `document:${documentId}`,
    ];
    if (parentSessionId) tags.push(`parent:${parentSessionId}`);
    if (args.leaves.length > 1) tags.push("forked:true");
    const document: ImportDocumentPreview = {
      documentId,
      leafId,
      messageCount: chunkMessages.length,
      rawMessageCount: chunkMessages.length,
      projectedMessageCount: projection.messages.length,
      rawBytes: projection.rawBytes,
      projectedBytes: projection.projectedBytes,
      droppedToolResultCount: projection.droppedToolResultCount,
      droppedToolResultBytes: projection.droppedToolResultBytes,
      ...("droppedTools" in projection ? { droppedTools: projection.droppedTools } : {}),
      topDroppedTools: projection.topDroppedTools,
      keptToolErrorCount: projection.keptToolErrorCount,
      keptToolErrorBytes: projection.keptToolErrorBytes,
      ...("classificationReasonCounts" in projection
        ? { classificationReasonCounts: projection.classificationReasonCounts }
        : {}),
      estimatedDocumentCount: chunks.length,
      estimatedChunkCount: projection.estimatedChunkCount,
      importMode: mode,
      ...(projectionVersion ? { projectionVersion } : {}),
      ...(importProfile ? { importProfile } : {}),
      ...(mode === "curated" ? { chunkIndex: chunk.index, messageRange } : {}),
      contentHash,
      contentBytes: Buffer.byteLength(content, "utf8"),
      tags,
      updateMode,
      bankId: args.bankId,
      wouldWrite: true,
      status: "pending" as const,
    };
    const manifestEntry: ImportManifestEntry = {
      documentId,
      bankId: args.bankId,
      sourceFile: args.sessionFile,
      importedAt: new Date().toISOString(),
      contentHash,
      messageCount: chunkMessages.length,
      leafId,
      sessionId: args.sessionId,
      cwd: args.cwd,
      includeBranches: args.config.import.includeBranches,
      importMode: mode,
      toolResults: args.config.import.toolResults,
      ...(projectionVersion ? { projectionVersion } : {}),
      ...(importProfile ? { importProfile } : {}),
      ...(mode === "curated" ? { chunkIndex: chunk.index, messageRange } : {}),
      updateMode,
    };
    return {
      document,
      manifestEntry,
      content,
      context: `Historical Pi session import from ${args.sessionFile}, branch ${leafId}, chunk ${chunk.index}`,
      observationScopes,
    };
  });
}

export function previewImportBranch(args: Omit<ImportRetainArgs, "client">): ImportRetainResult[] {
  return buildImportBranch(args).map((built) => ({
    document: { ...built.document, wouldWrite: false },
    manifestEntry: built.manifestEntry,
  }));
}

export async function retainImportBranch(
  args: ImportRetainArgs & { documentId: string },
): Promise<ImportRetainResult> {
  const built = buildImportBranch(args).find(
    (candidate) => candidate.document.documentId === args.documentId,
  );
  if (!built)
    throw new Error(`Import document ${args.documentId} no longer exists in import plan.`);
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  const retainResult = await deliverImportRetain({
    cwd: args.cwd,
    config: args.config,
    client: args.client,
    bankId: args.bankId,
    content: built.content,
    context: built.context,
    documentId: built.document.documentId,
    updateMode: built.document.updateMode,
    tags: built.document.tags,
    metadata: {
      pi_session_file: args.sessionFile,
      imported: "true",
      cwd: args.cwd,
      session_id: args.sessionId,
      ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
      ...(args.parsed.parentSessionFile
        ? { parent_session_file: args.parsed.parentSessionFile }
        : {}),
      branch_leaf_id: built.document.leafId,
      import_mode: args.config.import.mode,
      ...(built.document.projectionVersion
        ? { projection_version: built.document.projectionVersion }
        : {}),
      ...(built.document.importProfile ? { import_profile: built.document.importProfile } : {}),
      ...(built.document.chunkIndex !== undefined
        ? { chunk_index: String(built.document.chunkIndex) }
        : {}),
      ...(built.document.messageRange
        ? {
            message_range_start: String(built.document.messageRange.start),
            message_range_end: String(built.document.messageRange.end),
          }
        : {}),
      content_hash: built.document.contentHash,
      include_branches: args.config.import.includeBranches,
      tool_results: args.config.import.toolResults,
      ...(args.parsed.sessionTimestamp ? { session_timestamp: args.parsed.sessionTimestamp } : {}),
    },
    ...(built.observationScopes.length ? { observationScopes: built.observationScopes } : {}),
  });
  if (!retainResult.delivered) {
    throw new ImportRetainQueuedError(
      `Hindsight import retain queued as ${retainResult.queueJobId}; ${retainResult.remaining} retain job${retainResult.remaining === 1 ? "" : "s"} pending`,
    );
  }
  return { document: built.document, manifestEntry: built.manifestEntry };
}
