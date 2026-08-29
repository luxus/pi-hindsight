import type { HindsightLikeClient, ResolvedConfig, RetainJob, UpdateMode } from "../types.js";
import type { ImportBranch, ParsedSession } from "./import-parse.js";
import { baseTags } from "../banks/banking.js";
import { buildDurableRetainJob } from "../lifecycle/retain.js";
import { createHash } from "node:crypto";
import { createMemoryIdentity } from "../operations/memory-identity.js";
import {
  enqueueRetain,
  flushRetain,
  readQueuedRetains,
  removeQueuedRetains,
} from "../queue/queue.js";
import { expandObservationScopes } from "../lifecycle/observation-scopes.js";
import { hashImportContent, type ImportManifestEntry } from "./import-plan.js";
import { importDocumentId, stableSessionId } from "../utils/session.js";
import { isInjectedHindsightMemory, projectMessage, projectMessages } from "../utils/messages.js";
import { redactError, redactSecrets } from "../utils/sanitize.js";
import { runRetainBeforeEnqueueCheck } from "../queue/retain-before-enqueue.js";

export interface ImportRetainIdentity {
  bankId: string;
  documentId: string;
  updateMode: UpdateMode;
  sourceFile: string;
  cwd: string;
  sessionId: string;
  leafId: string;
  includeBranches: "current-only" | "all-leaves";
  importMode?: "curated" | "raw" | "forensic" | undefined;
  toolResults?: "errors-only" | "summary" | "content" | undefined;
  importQualityProfile?: "compatible" | "strict" | undefined;
  projectionVersion?: string | undefined;
  importProfile?: string | undefined;
  chunkIndex?: number | undefined;
  messageRange?: { start: number; end: number } | undefined;
  contentHash: string;
}

const IMPORT_RETAIN_METADATA_KEYS = [
  "pi_session_file",
  "imported",
  "cwd",
  "session_id",
  "branch_leaf_id",
  "import_mode",
  "import_quality_profile",
  "projection_version",
  "import_profile",
  "chunk_index",
  "message_range_start",
  "message_range_end",
  "content_hash",
  "include_branches",
  "tool_results",
] as const;

function identityMetadata(identity: ImportRetainIdentity): Record<string, string | undefined> {
  return {
    pi_session_file: identity.sourceFile,
    imported: "true",
    cwd: identity.cwd,
    session_id: identity.sessionId,
    branch_leaf_id: identity.leafId,
    import_mode: identity.importMode,
    import_quality_profile: identity.importQualityProfile,
    projection_version: identity.projectionVersion,
    import_profile: identity.importProfile,
    ...(identity.chunkIndex !== undefined ? { chunk_index: String(identity.chunkIndex) } : {}),
    ...(identity.messageRange
      ? {
          message_range_start: String(identity.messageRange.start),
          message_range_end: String(identity.messageRange.end),
        }
      : {}),
    content_hash: identity.contentHash,
    include_branches: identity.includeBranches,
    tool_results: identity.toolResults,
  };
}

function recordEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function isImportRetainJob(job: RetainJob): boolean {
  return (
    job.item.metadata?.source === "pi-hindsight" &&
    job.item.metadata.retainSource === "import" &&
    job.item.metadata.imported === "true"
  );
}

export function importRetainJobMatchesReference(job: RetainJob, reference: RetainJob): boolean {
  return (
    job.bankId === reference.bankId &&
    job.documentId === reference.documentId &&
    job.updateMode === reference.updateMode &&
    isImportRetainJob(job) &&
    isImportRetainJob(reference) &&
    job.item.content === reference.item.content &&
    job.item.context === reference.item.context &&
    recordEqual(job.item.metadata, reference.item.metadata) &&
    stableEqual(job.item.tags, reference.item.tags) &&
    stableEqual(job.item.observationScopes, reference.item.observationScopes)
  );
}

export function staleImportRetainJobForReference(job: RetainJob, reference: RetainJob): boolean {
  return (
    job.bankId === reference.bankId &&
    job.documentId === reference.documentId &&
    isImportRetainJob(job) &&
    !importRetainJobMatchesReference(job, reference)
  );
}

export function importRetainJobMatchesIdentity(
  job: RetainJob,
  identity: ImportRetainIdentity,
): boolean {
  if (
    job.bankId !== identity.bankId ||
    job.documentId !== identity.documentId ||
    job.updateMode !== identity.updateMode ||
    !isImportRetainJob(job)
  ) {
    return false;
  }
  const expected = identityMetadata(identity);
  const metadata = job.item.metadata ?? {};
  return IMPORT_RETAIN_METADATA_KEYS.every((key) => metadata[key] === expected[key]);
}

export interface ImportRetainDeliveryArgs {
  cwd: string;
  config: ResolvedConfig;
  client: HindsightLikeClient;
  bankId: string;
  content: string;
  context: string;
  documentId: string;
  updateMode: UpdateMode;
  tags: string[];
  metadata?: Record<string, string>;
  observationScopes?: string[][];
}

export interface ImportRetainDeliveryResult {
  queueJobId: string;
  enqueued: boolean;
  delivered: boolean;
  sent: number;
  remaining: number;
  deadLettered: number;
}

function stillQueued(jobs: RetainJob[], jobId: string): boolean {
  return jobs.some((job) => job.id === jobId);
}

export async function deliverImportRetain(
  args: ImportRetainDeliveryArgs,
): Promise<ImportRetainDeliveryResult> {
  const job = buildDurableRetainJob({
    cwd: args.cwd,
    config: args.config,
    bankId: args.bankId,
    content: args.content,
    context: args.context,
    documentId: args.documentId,
    updateMode: args.updateMode,
    tags: args.tags,
    source: "import",
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.observationScopes?.length ? { observationScopes: args.observationScopes } : {}),
  });
  await removeQueuedRetains(args.cwd, args.config, (queued) =>
    staleImportRetainJobForReference(queued, job),
  );
  const existing = await readQueuedRetains(args.cwd, args.config);
  const existingJob = existing.find((queued) => importRetainJobMatchesReference(queued, job));
  if (!existingJob) await enqueueRetain(args.cwd, args.config, job);
  const result = await flushRetain(args.cwd, args.config, args.client, {
    stopOnFirstFailure: true,
  });
  const queued = await readQueuedRetains(args.cwd, args.config);
  const queueJobId = existingJob?.id ?? job.id;
  return {
    queueJobId,
    enqueued: true,
    delivered: !stillQueued(queued, queueJobId),
    sent: result.sent,
    remaining: result.remaining,
    deadLettered: result.deadLettered,
  };
}

export const STRICT_SUCCESSFUL_TOOL_RESULT_MAX_BYTES = 2 * 1024;

export type ImportNoiseDropReason =
  | "successful-tool-output"
  | "tool-filter-excluded"
  | "tool-result-empty"
  | "recalled-memory"
  | "empty-projection"
  | "ui-noise"
  | "process-noise"
  | "oversized-output"
  | "repeated-output";

export interface ImportToolNoisePolicy {
  qualityProfile: ResolvedConfig["import"]["qualityProfile"];
  dropSuccessful: boolean;
  summaryMaxChars: number;
  strictSuccessfulToolResultMaxBytes: number;
}

export interface StrictImportNoiseState {
  seenSuccessfulToolResults: Set<string>;
}

export function createStrictImportNoiseState(): StrictImportNoiseState {
  return { seenSuccessfulToolResults: new Set<string>() };
}

export function resolveImportToolNoisePolicy(config: ResolvedConfig): ImportToolNoisePolicy {
  return {
    qualityProfile: config.import.qualityProfile,
    dropSuccessful: config.import.toolResults === "errors-only",
    summaryMaxChars: config.import.toolResultSummaryMaxChars,
    strictSuccessfulToolResultMaxBytes: STRICT_SUCCESSFUL_TOOL_RESULT_MAX_BYTES,
  };
}

export function importToolAllowed(
  name: string,
  filter: { include?: string[]; exclude?: string[] },
): boolean {
  if (filter.include && !filter.include.includes(name)) return false;
  return !filter.exclude?.includes(name);
}

function textFromToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean" || typeof content === "bigint")
    return String(content);
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "number" || typeof part === "boolean" || typeof part === "bigint")
        return String(part);
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        if (typeof record.output === "string") return record.output;
      }
      return JSON.stringify(part ?? "");
    })
    .filter(Boolean)
    .join("\n");
}

function normalizedName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const UI_NOISE_NAMES = new Set([
  "ui",
  "progress",
  "spinner",
  "toast",
  "notification",
  "render",
  "message_update",
  "extension_ui_request",
]);

const PROCESS_NOISE_NAMES = new Set([
  "process",
  "process-status",
  "status",
  "watcher",
  "watch",
  "ci-status",
  "check-status",
]);

const UI_NOISE_PATTERNS = [/\bspinner\b/i, /\btoast\b/i, /\bprogress ui\b/i, /\bmessage update\b/i];
const PROCESS_NOISE_PATTERNS = [
  /\brefreshing checks status\b/i,
  /\bchecks? (still )?pending\b/i,
  /\bwatcher (pending|continues|running)\b/i,
  /\bwaiting for ci\b/i,
  /\bprocess status\b/i,
];

function messageTypeNames(message: Record<string, unknown>): string[] {
  return [message.type, message.customType, message.event, message.kind]
    .map(normalizedName)
    .filter(Boolean);
}

export function summarizeToolResultContent(content: unknown, maxChars: number): string {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function successfulToolResultFingerprint(name: string, contentText: string): string {
  return createHash("sha256")
    .update(name)
    .update("\0")
    .update(contentText.trim().replace(/\s+/g, " "))
    .digest("hex");
}

export function strictSuccessfulToolResultDropReason(
  message: Record<string, unknown>,
  policy: ImportToolNoisePolicy,
  state: StrictImportNoiseState,
): ImportNoiseDropReason | undefined {
  if (policy.qualityProfile !== "strict") return undefined;
  if (message.role !== "toolResult" || message.isError === true) return undefined;

  const toolName = normalizedName(message.name ?? message.toolName ?? message.tool);
  const typeNames = messageTypeNames(message);
  const contentText = textFromToolResultContent(message.content);
  const contentBytes = Buffer.byteLength(contentText, "utf8");
  const combined = `${toolName}\n${typeNames.join("\n")}\n${contentText}`;

  if (UI_NOISE_NAMES.has(toolName) || typeNames.some((type) => UI_NOISE_NAMES.has(type)))
    return "ui-noise";
  if (
    PROCESS_NOISE_NAMES.has(toolName) ||
    typeNames.some((type) => PROCESS_NOISE_NAMES.has(type)) ||
    matchesAny(combined, PROCESS_NOISE_PATTERNS)
  ) {
    return "process-noise";
  }
  if (matchesAny(combined, UI_NOISE_PATTERNS)) return "ui-noise";
  if (!contentText.trim()) return "tool-result-empty";
  if (contentBytes > policy.strictSuccessfulToolResultMaxBytes) return "oversized-output";

  const fingerprint = successfulToolResultFingerprint(toolName, contentText);
  if (state.seenSuccessfulToolResults.has(fingerprint)) return "repeated-output";
  state.seenSuccessfulToolResults.add(fingerprint);
  return undefined;
}

export type CuratedImportKeepReason =
  | "user-text"
  | "assistant-text"
  | "tool-error-kept"
  | "message-kept";

export type CuratedImportDropReason = ImportNoiseDropReason;

export type CuratedImportReason = CuratedImportKeepReason | CuratedImportDropReason;

export interface CuratedImportClassification {
  original: Record<string, unknown>;
  stableMessage: Record<string, unknown>;
  projectedMessages: Record<string, unknown>[];
  decision: "keep" | "drop";
  reasons: CuratedImportReason[];
  rawBytes: number;
  projectedBytes: number;
  toolName?: string;
  toolResultDropped?: boolean;
  toolErrorKept?: boolean;
}

export interface CuratedImportProjection {
  messages: Record<string, unknown>[];
  rawBytes: number;
  projectedBytes: number;
  droppedToolResultCount: number;
  droppedToolResultBytes: number;
  droppedTools: Array<{ name: string; count: number; bytes: number }>;
  topDroppedTools: Array<{ name: string; count: number; bytes: number }>;
  keptToolErrorCount: number;
  keptToolErrorBytes: number;
  estimatedChunkCount: number;
  classificationReasonCounts: Partial<Record<CuratedImportReason, number>>;
  classifications: CuratedImportClassification[];
}

export function importByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function importToolName(message: Record<string, unknown>): string {
  const name = message.name ?? message.toolName ?? message.tool;
  return typeof name === "string" && name.trim() ? name : "unknown";
}

export function stableProjectionMessage(message: Record<string, unknown>): Record<string, unknown> {
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

function mergeImportProvenance(
  original: Record<string, unknown>,
  projectedMessages: Record<string, unknown>[],
): Record<string, unknown>[] {
  return projectedMessages.map((message) => ({
    ...(original.id !== undefined ? { id: original.id } : {}),
    ...(original.parentId !== undefined ? { parentId: original.parentId } : {}),
    ...message,
  }));
}

function keepReason(message: Record<string, unknown>): CuratedImportKeepReason {
  if (message.role === "user") return "user-text";
  if (message.role === "assistant") return "assistant-text";
  if (message.role === "toolResult" && message.isError === true) return "tool-error-kept";
  return "message-kept";
}

function dropReasons(
  message: Record<string, unknown>,
  projectedMessages: Record<string, unknown>[],
  config: ResolvedConfig,
  strictDropReason?: ImportNoiseDropReason,
): CuratedImportDropReason[] {
  if (isInjectedHindsightMemory(message)) return ["recalled-memory"];
  if (strictDropReason) return [strictDropReason];
  if (!projectedMessages.length && message.role === "toolResult" && message.isError !== true) {
    if (!importToolAllowed(importToolName(message), config.retain.toolFilter.toolResult))
      return ["tool-filter-excluded"];
    return ["successful-tool-output"];
  }
  return ["empty-projection"];
}

interface CuratedImportProjectionDecision {
  projectedMessages: Record<string, unknown>[];
  strictDropReason?: ImportNoiseDropReason;
}

function projectCuratedImportMessage(
  stableMessage: Record<string, unknown>,
  config: ResolvedConfig,
  strictState: StrictImportNoiseState,
): CuratedImportProjectionDecision {
  if (stableMessage.role !== "toolResult" || stableMessage.isError === true) {
    return { projectedMessages: projectMessages([stableMessage as never], config) };
  }
  const policy = resolveImportToolNoisePolicy(config);
  if (!importToolAllowed(importToolName(stableMessage), config.retain.toolFilter.toolResult)) {
    return { projectedMessages: [] };
  }
  const strictDropReason = strictSuccessfulToolResultDropReason(stableMessage, policy, strictState);
  if (strictDropReason || policy.dropSuccessful)
    return { projectedMessages: [], ...(strictDropReason ? { strictDropReason } : {}) };
  const projected = projectMessage(stableMessage as never, {
    ...config,
    retain: {
      ...config.retain,
      content: {
        ...config.retain.content,
        toolResult: config.import.toolResults === "content" ? ["content"] : ["summary"],
      },
    },
  });
  return {
    projectedMessages: [
      config.import.toolResults === "summary"
        ? {
            ...projected,
            content: summarizeToolResultContent(stableMessage.content, policy.summaryMaxChars),
          }
        : projected,
    ],
  };
}

export function classifyCuratedImportMessage(
  message: Record<string, unknown>,
  config: ResolvedConfig,
  strictState: StrictImportNoiseState = createStrictImportNoiseState(),
): CuratedImportClassification {
  const stableMessage = stableProjectionMessage(message);
  const projectionDecision = projectCuratedImportMessage(stableMessage, config, strictState);
  const projectedMessages = mergeImportProvenance(
    stableMessage,
    projectionDecision.projectedMessages,
  );
  const decision = projectedMessages.length ? "keep" : "drop";
  const reasons =
    decision === "keep"
      ? [keepReason(stableMessage)]
      : dropReasons(stableMessage, projectedMessages, config, projectionDecision.strictDropReason);
  const rawBytes = importByteLength(stableMessage);
  const projectedBytes = importByteLength(projectedMessages);
  return {
    original: message,
    stableMessage,
    projectedMessages,
    decision,
    reasons,
    rawBytes,
    projectedBytes,
    ...(stableMessage.role === "toolResult" ? { toolName: importToolName(stableMessage) } : {}),
    ...(stableMessage.role === "toolResult" && decision === "drop"
      ? { toolResultDropped: true }
      : {}),
    ...(stableMessage.role === "toolResult" && stableMessage.isError === true && decision === "keep"
      ? { toolErrorKept: true }
      : {}),
  };
}

function incrementReasonCounts(
  counts: Partial<Record<CuratedImportReason, number>>,
  reasons: CuratedImportReason[],
): void {
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
}

export function buildCuratedImportProjection(
  messages: Array<{ data: Record<string, unknown> }>,
  config: ResolvedConfig,
): CuratedImportProjection {
  const droppedTools = new Map<string, { count: number; bytes: number }>();
  const classificationReasonCounts: Partial<Record<CuratedImportReason, number>> = {};
  const strictState = createStrictImportNoiseState();
  const classifications = messages.map((message) =>
    classifyCuratedImportMessage(message.data, config, strictState),
  );
  const projected = classifications.flatMap((classification) => {
    incrementReasonCounts(classificationReasonCounts, classification.reasons);
    if (classification.toolResultDropped) {
      const name = classification.toolName ?? "unknown";
      const current = droppedTools.get(name) ?? { count: 0, bytes: 0 };
      droppedTools.set(name, {
        count: current.count + 1,
        bytes: current.bytes + classification.rawBytes,
      });
    }
    return classification.projectedMessages;
  });
  const keptToolErrors = classifications.filter((classification) => classification.toolErrorKept);
  return {
    messages: projected,
    rawBytes: classifications.reduce((total, classification) => total + classification.rawBytes, 0),
    projectedBytes: importByteLength(projected),
    droppedToolResultCount: [...droppedTools.values()].reduce(
      (total, tool) => total + tool.count,
      0,
    ),
    droppedToolResultBytes: [...droppedTools.values()].reduce(
      (total, tool) => total + tool.bytes,
      0,
    ),
    keptToolErrorCount: keptToolErrors.length,
    keptToolErrorBytes: keptToolErrors.reduce(
      (total, classification) => total + classification.rawBytes,
      0,
    ),
    estimatedChunkCount: Math.max(1, Math.ceil(importByteLength(projected) / 8_000)),
    droppedTools: [...droppedTools]
      .map(([name, value]) => ({ name, ...value }))
      .sort(
        (left, right) =>
          right.bytes - left.bytes ||
          right.count - left.count ||
          left.name.localeCompare(right.name),
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
    classificationReasonCounts,
    classifications,
  };
}

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
  importQualityProfile?: ResolvedConfig["import"]["qualityProfile"];
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
  status: "pending" | "queued" | "completed" | "failed" | "skipped" | "quarantined";
  queueAdmission?: "would-enqueue" | "quarantined";
  skipReason?: "already-imported" | "empty-curated-projection";
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

function shouldSurfaceImportQualityProfile(config: ResolvedConfig): boolean {
  return config.import.mode === "curated" && config.import.qualityProfile !== "compatible";
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
        cwd: args.cwd,
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
        ...(shouldSurfaceImportQualityProfile(args.config)
          ? { importQualityProfile: args.config.import.qualityProfile }
          : {}),
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
      ...baseTags(args.cwd, args.sessionId, leafId, args.config),
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
      ...(shouldSurfaceImportQualityProfile(args.config)
        ? { importQualityProfile: args.config.import.qualityProfile }
        : {}),
      ...(projectionVersion ? { projectionVersion } : {}),
      ...(importProfile ? { importProfile } : {}),
      ...(mode === "curated" ? { chunkIndex: chunk.index, messageRange } : {}),
      contentHash,
      contentBytes: Buffer.byteLength(content, "utf8"),
      tags,
      updateMode,
      bankId: args.bankId,
      wouldWrite: !(mode === "curated" && projection.messages.length === 0),
      status:
        mode === "curated" && projection.messages.length === 0
          ? ("skipped" as const)
          : ("pending" as const),
      ...(mode === "curated" && projection.messages.length === 0
        ? { skipReason: "empty-curated-projection" as const }
        : {}),
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
      ...(shouldSurfaceImportQualityProfile(args.config)
        ? { importQualityProfile: args.config.import.qualityProfile }
        : {}),
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

export async function previewImportBranchWithQueueAdmission(
  args: Omit<ImportRetainArgs, "client">,
): Promise<ImportRetainResult[]> {
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  const previews: ImportRetainResult[] = [];
  for (const built of buildImportBranch(args)) {
    const preview = { ...built.document, wouldWrite: false };
    if (!built.document.wouldWrite || built.document.status === "skipped") {
      previews.push({ document: preview, manifestEntry: built.manifestEntry });
      continue;
    }
    const job = buildDurableRetainJob({
      cwd: args.cwd,
      config: args.config,
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
        ...(shouldSurfaceImportQualityProfile(args.config)
          ? { import_quality_profile: args.config.import.qualityProfile }
          : {}),
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
        ...(args.parsed.sessionTimestamp
          ? { session_timestamp: args.parsed.sessionTimestamp }
          : {}),
      },
      source: "import",
      ...(built.observationScopes.length ? { observationScopes: built.observationScopes } : {}),
    });
    try {
      await runRetainBeforeEnqueueCheck(args.config, job);
      previews.push({
        document: { ...preview, queueAdmission: "would-enqueue" as const },
        manifestEntry: built.manifestEntry,
      });
    } catch (error) {
      previews.push({
        document: {
          ...preview,
          status: "quarantined" as const,
          queueAdmission: "quarantined" as const,
          error: redactError(error),
        },
        manifestEntry: built.manifestEntry,
      });
    }
  }
  return previews;
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
      ...(shouldSurfaceImportQualityProfile(args.config)
        ? { import_quality_profile: args.config.import.qualityProfile }
        : {}),
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
