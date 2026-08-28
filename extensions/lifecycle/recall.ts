import { basename } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  RECALL_SCORE_FIELDS,
  type HindsightLikeClient,
  type HindsightTagGroup,
  type RecallBlock,
  type RecallFailure,
  type RecallMinScores,
  type RecallResultItem,
  type RecallRole,
  type ResolvedConfig,
} from "../types.js";
import { isInjectedHindsightMemory, projectMessageText } from "../utils/messages.js";
import { createMemoryIdentity } from "../operations/memory-identity.js";
import { redactError } from "../utils/sanitize.js";
import { withTimeout } from "../client/timeout.js";
import { loadMentalModelsForScopes } from "./mental-models.js";

export interface RecallScope {
  kind?: "project" | "global";
  bankId: string;
  tagGroups?: HindsightTagGroup[];
}

function sourceFactText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? text : undefined;
}

function textFromRecallResponse(response: unknown): RecallResultItem[] {
  const record = response as Record<string, unknown>;
  const raw = Array.isArray(record.results)
    ? record.results
    : Array.isArray(record.memories)
      ? record.memories
      : Array.isArray(response)
        ? response
        : [];
  const sourceFacts =
    record.source_facts && typeof record.source_facts === "object"
      ? (record.source_facts as Record<string, unknown>)
      : undefined;
  return raw.map((entry) => {
    const item = entry as RecallResultItem;
    if (!sourceFacts || !item.source_fact_ids?.length) return item;
    const evidence = item.source_fact_ids
      .map((id) => sourceFactText(sourceFacts[id]))
      .filter((text): text is string => Boolean(text));
    return evidence.length ? { ...item, sourceFacts: evidence } : item;
  });
}

function itemText(item: RecallResultItem): string {
  return item.text ?? item.content ?? JSON.stringify(item);
}

export interface RecallQueryPolicy {
  roles: RecallRole[];
  contextTurns: number;
  maxQueryChars: number;
  preamble?: string;
  includeDate?: boolean;
  now?: Date;
  hints?: string[];
}

function messageRole(message: AgentMessage): string {
  return (message as unknown as { role?: string }).role ?? "unknown";
}

function messageContent(message: AgentMessage): string {
  const content = projectMessageText(message).content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function formatQueryMessage(message: AgentMessage): string | undefined {
  const content = messageContent(message).trim();
  return content ? `${messageRole(message)}: ${content}` : undefined;
}

export function truncateRecallQuery(query: string, maxChars: number): string {
  if (query.length <= maxChars) return query;
  return query.slice(query.length - maxChars).trimStart();
}

function truncateRecallQueryLines(
  prefixLines: string[],
  messageLines: string[],
  maxChars: number,
): string {
  const lines = [...prefixLines, ...messageLines];
  const query = lines.join("\n\n").trim();
  if (query.length <= maxChars) return query;
  const prefix = prefixLines.join("\n\n").trim();
  if (!prefix) return truncateRecallQuery(query, maxChars);
  const separator = "\n\n";
  const remaining = maxChars - prefix.length - separator.length;
  if (remaining >= 20)
    return `${prefix}${separator}${truncateRecallQuery(messageLines.join("\n\n"), remaining)}`;
  return truncateRecallQuery(query, maxChars);
}

export function composeRecallQuery(messages: AgentMessage[], policy: RecallQueryPolicy): string {
  const allowedRoles = new Set<string>(policy.roles);
  const selectedLines = messages
    .filter((message) => allowedRoles.has(messageRole(message)))
    .filter((message) => !isInjectedHindsightMemory(message))
    .map(formatQueryMessage)
    .filter((line): line is string => Boolean(line))
    .slice(-Math.max(1, policy.contextTurns));
  const prefixLines = [
    ...(policy.preamble?.trim() ? [policy.preamble.trim()] : []),
    ...(policy.includeDate
      ? [`Current date: ${(policy.now ?? new Date()).toISOString().slice(0, 10)}`]
      : []),
    ...(policy.hints?.length ? [`Context hints: ${policy.hints.join("; ")}`] : []),
  ];
  return truncateRecallQueryLines(
    prefixLines,
    selectedLines.length ? selectedLines : ["current Pi coding task"],
    policy.maxQueryChars,
  );
}

const RECALL_SOURCE_FACT_LINES = 3;

export function renderRecallBlocks(blocks: RecallBlock[], topK = 12): string {
  const nonEmpty = blocks.filter((block) => block.memoryCount > 0);
  if (nonEmpty.length === 0) return "";
  const lines = [
    "<hindsight-memory>",
    "Relevant prior memory. Use as context; do not quote unless useful.",
  ];
  for (const block of nonEmpty) {
    lines.push(`\nBank: ${block.bankId}`);
    block.results.slice(0, topK).forEach((item, index) => {
      const tags = item.tags?.length ? ` [${item.tags.join(", ")}]` : "";
      lines.push(`${index + 1}. ${itemText(item)}${tags}`);
      for (const fact of (item.sourceFacts ?? []).slice(0, RECALL_SOURCE_FACT_LINES)) {
        lines.push(`   - evidence: ${fact}`);
      }
    });
  }
  lines.push("</hindsight-memory>");
  return lines.join("\n");
}

function preambleForScope(config: ResolvedConfig, scope: RecallScope): string {
  if (scope.kind === "project") return config.recall.projectQueryPreamble;
  if (scope.kind === "global") return config.recall.globalQueryPreamble;
  return config.recall.queryPreamble;
}

// User Bank recall is a smaller, durable supplement to project context, not an equal-weight
// second corpus, so it gets its own (smaller by default) token budget. Project Bank recall
// keeps recall.maxTokens unchanged so single-scope callers see no behavior change.
function maxTokensForScope(config: ResolvedConfig, scope: RecallScope): number {
  return scope.kind === "global" ? config.recall.userMaxTokens : config.recall.maxTokens;
}

function queryHints(cwd: string, config: ResolvedConfig, scope: RecallScope): string[] {
  const hints = scope.kind ? [`scope:${scope.kind}`] : [];
  if (!config.recall.includeRepoHintsInQuery || scope.kind === "global") return hints;
  const identity = createMemoryIdentity(cwd, config);
  return [
    ...hints,
    `project:${identity.projectId}`,
    `repo:${identity.repoKey}`,
    `cwd:${basename(cwd)}`,
  ];
}

export async function recallForContext(args: {
  client: HindsightLikeClient;
  config: ResolvedConfig;
  scopes: RecallScope[];
  messages: AgentMessage[];
  cwd?: string;
}): Promise<{
  rendered: string;
  blocks: RecallBlock[];
  failed: number;
  failures: RecallFailure[];
}> {
  const blocks: RecallBlock[] = [];
  const failures: RecallFailure[] = [];
  // Scope recalls run concurrently: with two banks (project + user) a sequential
  // loop paid the full per-bank latency twice at every turn start. Promise.all
  // preserves input order, so blocks and failures still appear in scope order;
  // the per-scope try/catch keeps one bank's failure from affecting the others.
  const scopeOutcomes = await Promise.all(
    args.scopes.map(async (scope) => {
      const query = composeRecallQuery(args.messages, {
        roles: args.config.recall.roles,
        contextTurns: args.config.recall.contextTurns,
        maxQueryChars: args.config.recall.maxQueryChars,
        preamble: preambleForScope(args.config, scope),
        includeDate: args.config.recall.includeDateInQuery,
        hints: args.cwd ? queryHints(args.cwd, args.config, scope) : [],
      });
      try {
        // Forward the timeout's AbortSignal into the client call: the adapted
        // client treats options.signal as a parent signal, so when this outer
        // recall timeout fires the underlying fetch is aborted and the server
        // sees a client disconnect and cancels the recall instead of running it
        // to completion. Without this the outer timeout rejects the turn-side
        // promise while the request keeps running up to the client-level timeout.
        const response = await withTimeout(
          "hindsight recall",
          args.config.recall.timeoutMs,
          (signal) =>
            args.client.recall(scope.bankId, query, {
              budget: args.config.recall.budget,
              maxTokens: maxTokensForScope(args.config, scope),
              types: args.config.recall.types,
              preferObservations: args.config.recall.preferObservations,
              ...(args.config.recall.includeSourceFacts
                ? {
                    includeSourceFacts: true,
                    maxSourceFactsTokens: args.config.recall.maxSourceFactsTokens,
                  }
                : {}),
              ...(args.config.recall.queryTimestamp
                ? { queryTimestamp: args.config.recall.queryTimestamp }
                : {}),
              ...(scope.tagGroups?.length ? { tagGroups: scope.tagGroups } : {}),
              signal,
            }),
        );
        const results = filterRecallQuality(
          textFromRecallResponse(response),
          args.config.recall.minScores,
        ).items;
        return {
          ok: true as const,
          block: {
            bankId: scope.bankId,
            query,
            results,
            memoryCount: results.length,
            rendered: "",
          },
        };
      } catch (error) {
        return {
          ok: false as const,
          failure: {
            bankId: scope.bankId,
            query,
            error: redactError(error),
            ...(scope.kind ? { kind: scope.kind } : {}),
            ...(scope.tagGroups?.length ? { tagGroups: scope.tagGroups } : {}),
          },
        };
      }
    }),
  );
  for (const outcome of scopeOutcomes) {
    if (outcome.ok) blocks.push(outcome.block);
    else failures.push(outcome.failure);
  }
  const recallRendered = renderRecallBlocks(blocks, args.config.recall.topK);
  const cwd = args.cwd ?? process.cwd();
  const identity = createMemoryIdentity(cwd, args.config);
  const mental = await loadMentalModelsForScopes({
    client: args.client,
    config: args.config,
    bankIds: args.scopes.map((scope) => scope.bankId),
    bankKinds: args.scopes.map((scope) => (scope.kind === "global" ? "user" : "project")),
    projectId: identity.projectId,
  });
  const rendered = [mental.rendered, recallRendered].filter(Boolean).join("\n\n");
  return {
    rendered,
    blocks: blocks.map((block) => ({ ...block, rendered: recallRendered })),
    failed: failures.length,
    failures,
  };
}

export type RecallQualityDropReason =
  | "blank-memory"
  | "recall-contamination"
  | "duplicate-memory"
  | "below-score-floor";

export interface RecallQualityDecision {
  item: RecallResultItem;
  decision: "keep" | "drop";
  reasons: RecallQualityDropReason[];
}

function normalizedMemoryText(item: RecallResultItem): string {
  return itemText(item).replace(/\s+/g, " ").trim().toLowerCase();
}

function isRecallContamination(text: string): boolean {
  return /<\/?hindsight[-_]memor(?:y|ies)>|<\/?hindsight-mental-models>|<\/?mental_models>|customType["']?\s*:\s*["']hindsight-(?:recall|mental-models)|last-recall\.json/.test(
    text,
  );
}

function isBelowScoreFloor(item: RecallResultItem, minScores?: RecallMinScores): boolean {
  if (!minScores) return false;
  const scores = item.scores;
  // Fail open when Hindsight omits scores so BM25-only hits and passthrough rerankers
  // are not silently discarded by local policy.
  if (!scores) return false;
  for (const field of RECALL_SCORE_FIELDS) {
    const floor = minScores[field];
    const value = scores[field];
    if (typeof floor === "number" && typeof value === "number" && value < floor) return true;
  }
  return false;
}

export function classifyRecallQuality(
  item: RecallResultItem,
  seen: Set<string>,
  minScores?: RecallMinScores,
): RecallQualityDecision {
  const text = normalizedMemoryText(item);
  const reasons: RecallQualityDropReason[] = [];
  if (!text) reasons.push("blank-memory");
  if (isRecallContamination(itemText(item))) reasons.push("recall-contamination");
  if (text && seen.has(text)) reasons.push("duplicate-memory");
  if (isBelowScoreFloor(item, minScores)) reasons.push("below-score-floor");
  if (!reasons.length) seen.add(text);
  return { item, decision: reasons.length ? "drop" : "keep", reasons };
}

export function filterRecallQuality(
  items: RecallResultItem[],
  minScores?: RecallMinScores,
): {
  items: RecallResultItem[];
  decisions: RecallQualityDecision[];
  dropped: number;
  reasonCounts: Partial<Record<RecallQualityDropReason, number>>;
} {
  const seen = new Set<string>();
  const decisions = items.map((item) => classifyRecallQuality(item, seen, minScores));
  const reasonCounts: Partial<Record<RecallQualityDropReason, number>> = {};
  for (const decision of decisions) {
    for (const reason of decision.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    items: decisions
      .filter((decision) => decision.decision === "keep")
      .map((decision) => decision.item),
    decisions,
    dropped: decisions.filter((decision) => decision.decision === "drop").length,
    reasonCounts,
  };
}
