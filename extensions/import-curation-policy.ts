import type { ResolvedConfig } from "./types.js";
import { isInjectedHindsightMemory, projectMessage, projectMessages } from "./messages.js";
import {
  importToolAllowed,
  resolveImportToolNoisePolicy,
  summarizeToolResultContent,
  type ImportNoiseDropReason,
} from "./import-noise-policy.js";

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
): CuratedImportDropReason[] {
  if (isInjectedHindsightMemory(message)) return ["recalled-memory"];
  if (!projectedMessages.length && message.role === "toolResult" && message.isError !== true) {
    if (!importToolAllowed(importToolName(message), config.retain.toolFilter.toolResult))
      return ["tool-filter-excluded"];
    return ["successful-tool-output"];
  }
  return ["empty-projection"];
}

function projectCuratedImportMessage(
  stableMessage: Record<string, unknown>,
  config: ResolvedConfig,
): Record<string, unknown>[] {
  if (stableMessage.role !== "toolResult" || stableMessage.isError === true) {
    return projectMessages([stableMessage as never], config);
  }
  const policy = resolveImportToolNoisePolicy(config);
  if (policy.dropSuccessful) return [];
  if (!importToolAllowed(importToolName(stableMessage), config.retain.toolFilter.toolResult))
    return [];
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
  return [
    config.import.toolResults === "summary"
      ? {
          ...projected,
          content: summarizeToolResultContent(stableMessage.content, policy.summaryMaxChars),
        }
      : projected,
  ];
}

export function classifyCuratedImportMessage(
  message: Record<string, unknown>,
  config: ResolvedConfig,
): CuratedImportClassification {
  const stableMessage = stableProjectionMessage(message);
  const projectedMessages = mergeImportProvenance(
    stableMessage,
    projectCuratedImportMessage(stableMessage, config),
  );
  const decision = projectedMessages.length ? "keep" : "drop";
  const reasons =
    decision === "keep"
      ? [keepReason(stableMessage)]
      : dropReasons(stableMessage, projectedMessages, config);
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
  const classifications = messages.map((message) =>
    classifyCuratedImportMessage(message.data, config),
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
