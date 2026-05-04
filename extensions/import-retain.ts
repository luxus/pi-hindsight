import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importDocumentId, stableSessionId } from "./session.js";
import { baseTags } from "./banking.js";
import { redactSecrets } from "./sanitize.js";
import { hashImportContent, type ImportManifestEntry } from "./import-manifest.js";
import { createMemoryIdentity } from "./memory-identity.js";
import { isInjectedHindsightMemory, projectMessages } from "./messages.js";
import { expandObservationScopes } from "./observation-scopes.js";
import type { ImportBranch } from "./import-branches.js";
import type { ParsedSession } from "./import-parser.js";
import { deliverImportRetain } from "./import-delivery.js";

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
  topDroppedTools?: Array<{ name: string; count: number; bytes: number }>;
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

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function toolName(message: Record<string, unknown>): string {
  const name = message.name ?? message.toolName ?? message.tool;
  return typeof name === "string" && name.trim() ? name : "unknown";
}

function stableProjectionMessage(message: Record<string, unknown>): Record<string, unknown> {
  const timestamp = message.timestamp;
  const parsedTimestamp = typeof timestamp === "string" ? Date.parse(timestamp) : undefined;
  return {
    ...message,
    timestamp:
      typeof timestamp === "number"
        ? timestamp
        : typeof parsedTimestamp === "number" && Number.isFinite(parsedTimestamp)
          ? parsedTimestamp
          : 0,
  };
}

function buildCuratedImportProjection(
  messages: Array<{ data: Record<string, unknown> }>,
  config: ResolvedConfig,
): {
  messages: Record<string, unknown>[];
  rawBytes: number;
  projectedBytes: number;
  droppedToolResultCount: number;
  droppedToolResultBytes: number;
  topDroppedTools: Array<{ name: string; count: number; bytes: number }>;
} {
  const droppedTools = new Map<string, { count: number; bytes: number }>();
  const projected = messages.flatMap((message) => {
    const stableMessage = stableProjectionMessage(message.data);
    const projectedMessage = projectMessages([stableMessage as never], config);
    if (!projectedMessage.length && stableMessage.role === "toolResult") {
      const name = toolName(stableMessage);
      const bytes = byteLength(stableMessage);
      const current = droppedTools.get(name) ?? { count: 0, bytes: 0 };
      droppedTools.set(name, { count: current.count + 1, bytes: current.bytes + bytes });
    }
    return projectedMessage;
  });
  return {
    messages: projected,
    rawBytes: messages.reduce((total, message) => total + byteLength(message.data), 0),
    projectedBytes: byteLength(projected),
    droppedToolResultCount: [...droppedTools.values()].reduce(
      (total, tool) => total + tool.count,
      0,
    ),
    droppedToolResultBytes: [...droppedTools.values()].reduce(
      (total, tool) => total + tool.bytes,
      0,
    ),
    topDroppedTools: [...droppedTools]
      .map(([name, value]) => ({ name, ...value }))
      .sort(
        (left, right) =>
          right.bytes - left.bytes ||
          right.count - left.count ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 5),
  };
}

function buildImportBranch(args: Omit<ImportRetainArgs, "client">): ImportBranchBuildResult {
  const leafId = args.branch.leafId;
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  const branchMessages = args.branch.messages.filter(
    (message) => !isInjectedHindsightMemory(message.data),
  );
  const projection = buildCuratedImportProjection(branchMessages, args.config);
  const documentId = importDocumentId(args.sessionId, leafId);
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
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
      projection: "raw-with-curated-preview-v1",
      projectedMessageCount: projection.messages.length,
      messages: branchMessages.map((message) => message.data),
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
  const identity = createMemoryIdentity(args.cwd, args.config, args.sessionFile);
  const observationScopes = args.config.observations.enabled
    ? expandObservationScopes(args.config.observations.scopes, {
        ...identity,
        sessionId: args.sessionId,
        projectBankId: args.bankId,
      })
    : [];
  const document: ImportDocumentPreview = {
    documentId,
    leafId,
    messageCount: branchMessages.length,
    rawMessageCount: branchMessages.length,
    projectedMessageCount: projection.messages.length,
    rawBytes: projection.rawBytes,
    projectedBytes: projection.projectedBytes,
    droppedToolResultCount: projection.droppedToolResultCount,
    droppedToolResultBytes: projection.droppedToolResultBytes,
    topDroppedTools: projection.topDroppedTools,
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
    messageCount: branchMessages.length,
    leafId,
    sessionId: args.sessionId,
    cwd: args.cwd,
    includeBranches: args.config.import.includeBranches,
    updateMode,
  };
  return {
    document,
    manifestEntry,
    content,
    context: `Historical Pi session import from ${args.sessionFile}, branch ${leafId}`,
    observationScopes,
  };
}

export function previewImportBranch(args: Omit<ImportRetainArgs, "client">): ImportRetainResult {
  const built = buildImportBranch(args);
  return { document: { ...built.document, wouldWrite: false }, manifestEntry: built.manifestEntry };
}

export async function retainImportBranch(args: ImportRetainArgs): Promise<ImportRetainResult> {
  const built = buildImportBranch(args);
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
      include_branches: args.config.import.includeBranches,
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
