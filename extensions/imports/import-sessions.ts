import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  buildImportPlan,
  createImportCheckpoint,
  hashImportContent,
  type ImportCheckpoint,
  type ImportCheckpointDocument,
  type ImportDocumentStatus,
  type ImportPlan,
  readImportCheckpointSafe,
  readImportManifestSafe,
  upsertImportManifestEntries,
  writeImportCheckpoint,
} from "./import-plan.js";
import { createHash } from "node:crypto";
import {
  deliverImportRetain,
  type ImportDocumentPreview,
  importRetainJobMatchesIdentity,
  ImportRetainQueuedError,
  type ImportRetainResult,
  isImportRetainQueuedError,
  previewImportBranch,
  retainImportBranch,
} from "./import-execute.js";
import { importDocumentId } from "../utils/session.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { redactError, redactSecrets } from "../utils/sanitize.js";
import { removeQueuedRetains } from "../queue/queue.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import { type ParsedSession, parseImportSessionJsonl } from "./import-parse.js";
export { parseImportSessionJsonl, parsePiSessionJsonl } from "./import-parse.js";
export { selectImportBranches } from "./import-parse.js";
export type { ImportBranch } from "./import-parse.js";
export type { ParsedMessage, ParsedSession } from "./import-parse.js";

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

const KEPT_CHAT_TRANSCRIPT_EVENTS = new Set(["user_message", "assistant_reply", "process_end"]);

export interface ChatTranscriptEvent {
  type: string;
  timestamp?: string;
  content?: unknown;
  channel?: string;
  sessionId?: string;
  conversationId?: string;
  data: Record<string, unknown>;
}

export interface ChatTranscriptImportResult {
  sourceFile: string;
  documentId: string;
  retained: boolean;
  skipped: boolean;
  skipReason?: string;
  dryRun: boolean;
  bankId: string;
  keptEventCount: number;
  droppedEventCount: number;
  malformedLineCount: number;
  retainedTurnCount: number;
  droppedEventTypes: Array<{ type: string; count: number }>;
  contentHash: string;
  contentBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function eventType(record: Record<string, unknown>): string | undefined {
  return stringField(record, ["type", "event", "event_type", "kind"]);
}

function normalizeChatTranscriptEvent(
  record: Record<string, unknown>,
): ChatTranscriptEvent | undefined {
  const type = eventType(record);
  if (!type) return undefined;
  const content = record.content ?? record.text ?? record.message ?? record.output;
  const timestamp = stringField(record, ["timestamp", "created_at", "time"]);
  const channel = stringField(record, ["channel", "channel_id"]);
  const sessionId = stringField(record, ["session_id", "sessionId"]);
  const conversationId = stringField(record, ["conversation_id", "conversationId", "thread_id"]);
  return {
    type,
    ...(timestamp ? { timestamp } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(channel ? { channel } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(conversationId ? { conversationId } : {}),
    data: record,
  };
}

export function parseChatTranscriptJsonl(text: string): {
  kept: ChatTranscriptEvent[];
  droppedEventTypes: Array<{ type: string; count: number }>;
  droppedEventCount: number;
  malformedLineCount: number;
} {
  const kept: ChatTranscriptEvent[] = [];
  const dropped = new Map<string, number>();
  let malformedLineCount = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLineCount += 1;
      continue;
    }
    if (!isRecord(parsed)) {
      malformedLineCount += 1;
      continue;
    }
    const event = normalizeChatTranscriptEvent(parsed);
    if (!event) {
      malformedLineCount += 1;
      continue;
    }
    if (KEPT_CHAT_TRANSCRIPT_EVENTS.has(event.type)) kept.push(event);
    else dropped.set(event.type, (dropped.get(event.type) ?? 0) + 1);
  }
  return {
    kept,
    droppedEventTypes: [...dropped]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
    droppedEventCount: [...dropped.values()].reduce((total, count) => total + count, 0),
    malformedLineCount,
  };
}

function firstDefined(
  events: ChatTranscriptEvent[],
  key: "channel" | "sessionId" | "conversationId",
): string | undefined {
  return events.find((event) => event[key])?.[key];
}

function tagValue(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 80) || "unknown"
  );
}

function documentId(sourceFile: string, kept: ChatTranscriptEvent[]): string {
  const basis = JSON.stringify({ sourceFile, first: kept[0]?.data, last: kept.at(-1)?.data });
  return `pi-gateway-import:${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

export async function importChatTranscript(args: {
  sourceFile: string;
  cwd: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  onProgress?: ImportProgressReporter;
}): Promise<ChatTranscriptImportResult> {
  args.onProgress?.({
    phase: "reading",
    message: `Reading chat transcript ${args.sourceFile}`,
    sessionFile: args.sourceFile,
  });
  const parsed = parseChatTranscriptJsonl(await readFile(args.sourceFile, "utf8"));
  args.onProgress?.({
    phase: "planning",
    message: `Planning chat transcript import for ${parsed.kept.length} kept event${parsed.kept.length === 1 ? "" : "s"}`,
    sessionFile: args.sourceFile,
  });
  const docId = documentId(args.sourceFile, parsed.kept);
  const channel = firstDefined(parsed.kept, "channel");
  const sessionId = firstDefined(parsed.kept, "sessionId");
  const conversationId = firstDefined(parsed.kept, "conversationId");
  const contentRaw = JSON.stringify(
    {
      source: "chat-transcript-import",
      sourceFile: args.sourceFile,
      channel,
      sessionId,
      conversationId,
      events: parsed.kept.map((event) => event.data),
      droppedEventCount: parsed.droppedEventCount,
      droppedEventTypes: parsed.droppedEventTypes,
    },
    null,
    2,
  );
  const content = args.config.retain.redactSecrets ? redactSecrets(contentRaw) : contentRaw;
  const contentHash = createHash("sha256").update(content).digest("hex");
  const result: ChatTranscriptImportResult = {
    sourceFile: args.sourceFile,
    documentId: docId,
    retained: false,
    skipped: parsed.kept.length === 0,
    ...(parsed.kept.length === 0
      ? { skipReason: "No high-signal chat transcript events found." }
      : {}),
    dryRun: Boolean(args.dryRun),
    bankId: args.bankId,
    keptEventCount: parsed.kept.length,
    droppedEventCount: parsed.droppedEventCount,
    malformedLineCount: parsed.malformedLineCount,
    retainedTurnCount: parsed.kept.filter((event) => event.type === "user_message").length,
    droppedEventTypes: parsed.droppedEventTypes,
    contentHash,
    contentBytes: Buffer.byteLength(content, "utf8"),
  };
  if (args.dryRun || parsed.kept.length === 0) return result;
  args.onProgress?.({
    phase: "retaining",
    message: `Importing chat transcript document ${docId}`,
    sessionFile: args.sourceFile,
    current: 1,
    total: 1,
  });
  const delivery = await deliverImportRetain({
    cwd: args.cwd,
    config: args.config,
    client: args.client,
    bankId: args.bankId,
    content,
    context: `Chat transcript import from ${basename(args.sourceFile)}`,
    documentId: docId,
    updateMode: "replace",
    tags: [
      "source:chat",
      "import:chat",
      "imported:true",
      ...(channel ? [`channel:${tagValue(channel)}`] : []),
      ...(sessionId ? [`session:${tagValue(sessionId)}`] : []),
      ...(conversationId ? [`conversation:${tagValue(conversationId)}`] : []),
      `document:${docId}`,
    ],
    metadata: {
      source_file: args.sourceFile,
      imported: "true",
      source: "chat-transcript",
      ...(channel ? { channel } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      content_hash: contentHash,
    },
  });
  if (!delivery.delivered) {
    throw new ImportRetainQueuedError(
      `Chat transcript import queued as ${delivery.queueJobId}; ${delivery.remaining} retain job${delivery.remaining === 1 ? "" : "s"} pending`,
    );
  }
  return { ...result, retained: true };
}

export type ImportOperationDeps = {
  getClient(): HindsightLikeClient;
  getConfig(): ResolvedConfig;
  getProjectBankId(): string;
};

export async function importMemorySession(
  args: {
    sessionFile: string;
    cwd?: string;
    bank?: string;
    dryRun?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  const result = await importPiSession({
    sessionFile: args.sessionFile,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { bankId, ...result };
}

export async function importMemoryChatTranscript(
  args: {
    sourceFile: string;
    cwd: string;
    bank?: string;
    dryRun?: boolean;
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank ?? "global",
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  return importChatTranscript({
    sourceFile: args.sourceFile,
    cwd: args.cwd,
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
}

export async function importMemoryProjectSessions(
  args: {
    cwd: string;
    currentSessionFile?: string;
    searchDir?: string;
    bank?: string;
    dryRun?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  const result = await importProjectSessions({
    cwd: args.cwd,
    ...(args.currentSessionFile ? { currentSessionFile: args.currentSessionFile } : {}),
    ...(args.searchDir ? { searchDir: args.searchDir } : {}),
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { bankId, ...result };
}

export type ImportProgressEvent = {
  phase:
    | "reading"
    | "planning"
    | "previewing"
    | "retaining"
    | "discovering"
    | "discovered"
    | "session";
  message: string;
  sessionFile?: string;
  current?: number;
  total?: number;
};

export type ImportProgressReporter = (event: ImportProgressEvent) => void;

function sameProjectCwd(sessionCwd: string | undefined, cwd: string): boolean {
  if (!sessionCwd) return false;
  return resolve(sessionCwd) === resolve(cwd);
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
  malformedLineCount: number;
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
  malformedLineCount: number;
  documents: ImportSessionDocumentResult[];
}

export async function importPiSession(args: {
  sessionFile: string;
  cwd?: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  requireMatchingCwd?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
  onProgress?: ImportProgressReporter;
}): Promise<ImportSessionResult> {
  args.onProgress?.({
    phase: "reading",
    message: `Reading session file ${args.sessionFile}`,
    sessionFile: args.sessionFile,
  });
  const text = await readFile(args.sessionFile, "utf8");
  const parsed = parseImportSessionJsonl(text);
  args.onProgress?.({
    phase: "planning",
    message: `Planning import for ${parsed.messages.length} message${parsed.messages.length === 1 ? "" : "s"}`,
    sessionFile: args.sessionFile,
  });
  const plan = buildImportPlan({
    sessionFile: args.sessionFile,
    parsed,
    bankId: args.bankId,
    config: args.config,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.requireMatchingCwd !== undefined
      ? { requireMatchingCwd: args.requireMatchingCwd }
      : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
  });
  const execution = await executeImportPlan({
    client: args.client,
    parsed,
    plan,
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });

  const first = execution.documents[0] ?? {
    documentId: importDocumentId(plan.sessionId, "root"),
  };
  return {
    sessionFile: args.sessionFile,
    documentId: first.documentId,
    messageCount: execution.messageCount,
    retained: execution.retained,
    dryRun: Boolean(args.dryRun),
    manifestPath: plan.manifestPath,
    checkpointPath: plan.checkpointPath,
    runId: plan.runId,
    malformedLineCount: parsed.malformedLineCount,
    documents: execution.documents,
  };
}

export async function importProjectSessions(args: {
  cwd: string;
  currentSessionFile?: string;
  searchDir?: string;
  sessionFiles?: string[];
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
  onProgress?: ImportProgressReporter;
}): Promise<ImportProjectSessionsResult> {
  args.onProgress?.({ phase: "discovering", message: "Scanning project session files" });
  const discovery =
    args.sessionFiles !== undefined
      ? { sessionFiles: [...args.sessionFiles].sort(), scanned: args.sessionFiles.length }
      : await discoverProjectSessionFiles({
          cwd: args.cwd,
          ...(args.currentSessionFile ? { currentSessionFile: args.currentSessionFile } : {}),
          ...(args.searchDir ? { searchDir: args.searchDir } : {}),
        });
  args.onProgress?.({
    phase: "discovered",
    message: `Found ${discovery.sessionFiles.length} project session${discovery.sessionFiles.length === 1 ? "" : "s"} after scanning ${discovery.scanned} file${discovery.scanned === 1 ? "" : "s"}`,
    current: discovery.sessionFiles.length,
    total: discovery.scanned,
  });
  const imported: ImportSessionResult[] = [];
  for (const [index, sessionFile] of discovery.sessionFiles.entries()) {
    args.onProgress?.({
      phase: "session",
      message: `Importing project session ${index + 1}/${discovery.sessionFiles.length}: ${sessionFile}`,
      sessionFile,
      current: index + 1,
      total: discovery.sessionFiles.length,
    });
    imported.push(
      await importPiSession({
        sessionFile,
        cwd: args.cwd,
        requireMatchingCwd: true,
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
        ...(args.onProgress ? { onProgress: args.onProgress } : {}),
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
    malformedLineCount: imported.reduce((count, result) => count + result.malformedLineCount, 0),
  };
}
