import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { deliverImportRetain } from "./import-delivery.js";
import { ImportRetainQueuedError } from "./import-retain.js";
import { redactSecrets } from "./sanitize.js";

const KEPT_GATEWAY_EVENTS = new Set(["user_message", "assistant_reply", "process_end"]);

export interface GatewayTranscriptEvent {
  type: string;
  timestamp?: string;
  content?: unknown;
  channel?: string;
  sessionId?: string;
  conversationId?: string;
  data: Record<string, unknown>;
}

export interface GatewayTranscriptImportResult {
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

function normalizeGatewayEvent(
  record: Record<string, unknown>,
): GatewayTranscriptEvent | undefined {
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

export function parseGatewayTranscriptJsonl(text: string): {
  kept: GatewayTranscriptEvent[];
  droppedEventTypes: Array<{ type: string; count: number }>;
  droppedEventCount: number;
  malformedLineCount: number;
} {
  const kept: GatewayTranscriptEvent[] = [];
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
    const event = normalizeGatewayEvent(parsed);
    if (!event) {
      malformedLineCount += 1;
      continue;
    }
    if (KEPT_GATEWAY_EVENTS.has(event.type)) kept.push(event);
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
  events: GatewayTranscriptEvent[],
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

function documentId(sourceFile: string, kept: GatewayTranscriptEvent[]): string {
  const basis = JSON.stringify({ sourceFile, first: kept[0]?.data, last: kept.at(-1)?.data });
  return `pi-gateway-import:${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

export async function importGatewayTranscript(args: {
  sourceFile: string;
  cwd: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  dryRun?: boolean;
}): Promise<GatewayTranscriptImportResult> {
  const parsed = parseGatewayTranscriptJsonl(await readFile(args.sourceFile, "utf8"));
  const docId = documentId(args.sourceFile, parsed.kept);
  const channel = firstDefined(parsed.kept, "channel");
  const sessionId = firstDefined(parsed.kept, "sessionId");
  const conversationId = firstDefined(parsed.kept, "conversationId");
  const contentRaw = JSON.stringify(
    {
      source: "gateway-transcript-import",
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
  const result: GatewayTranscriptImportResult = {
    sourceFile: args.sourceFile,
    documentId: docId,
    retained: false,
    skipped: parsed.kept.length === 0,
    ...(parsed.kept.length === 0 ? { skipReason: "No high-signal gateway events found." } : {}),
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
  const delivery = await deliverImportRetain({
    cwd: args.cwd,
    config: args.config,
    client: args.client,
    bankId: args.bankId,
    content,
    context: `Gateway transcript import from ${basename(args.sourceFile)}`,
    documentId: docId,
    updateMode: "replace",
    tags: [
      "source:gateway",
      "import:gateway",
      "imported:true",
      ...(channel ? [`channel:${tagValue(channel)}`] : []),
      ...(sessionId ? [`session:${tagValue(sessionId)}`] : []),
      ...(conversationId ? [`conversation:${tagValue(conversationId)}`] : []),
      `document:${docId}`,
    ],
    metadata: {
      source_file: args.sourceFile,
      source: "gateway-transcript",
      ...(channel ? { channel } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      content_hash: contentHash,
    },
  });
  if (!delivery.delivered) {
    throw new ImportRetainQueuedError(
      `Gateway transcript import queued as ${delivery.queueJobId}; ${delivery.remaining} retain job${delivery.remaining === 1 ? "" : "s"} pending`,
    );
  }
  return { ...result, retained: true };
}
