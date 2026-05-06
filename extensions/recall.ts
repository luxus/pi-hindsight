import { basename } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  HindsightLikeClient,
  RecallBlock,
  RecallFailure,
  RecallResultItem,
  RecallRole,
  ResolvedConfig,
  TagsMatch,
} from "./types.js";
import { isInjectedHindsightMemory, projectMessageText } from "./messages.js";
import { createMemoryIdentity } from "./memory-identity.js";
import { redactError } from "./sanitize.js";
import { withTimeout } from "./timeout.js";
import { filterRecallQuality } from "./recall-quality-policy.js";

export interface RecallScope {
  kind?: "project" | "global";
  bankId: string;
  tags?: string[];
  tagsMatch?: TagsMatch;
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
  return raw.map((item) => item as RecallResultItem);
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

function queryHints(cwd: string, config: ResolvedConfig, scope: RecallScope): string[] {
  const hints = scope.kind ? [`scope:${scope.kind}`] : [];
  if (!config.recall.includeRepoHintsInQuery || scope.kind === "global") return hints;
  const identity = createMemoryIdentity(cwd, config);
  return [...hints, `repo:${identity.repoKey}`, `cwd:${basename(cwd)}`];
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
  for (const scope of args.scopes) {
    const query = composeRecallQuery(args.messages, {
      roles: args.config.recall.roles,
      contextTurns: args.config.recall.contextTurns,
      maxQueryChars: args.config.recall.maxQueryChars,
      preamble: preambleForScope(args.config, scope),
      includeDate: args.config.recall.includeDateInQuery,
      hints: args.cwd ? queryHints(args.cwd, args.config, scope) : [],
    });
    try {
      const response = await withTimeout("hindsight recall", args.config.recall.timeoutMs, () =>
        args.client.recall(scope.bankId, query, {
          budget: args.config.recall.budget,
          maxTokens: args.config.recall.maxTokens,
          types: args.config.recall.types,
          ...(args.config.recall.queryTimestamp
            ? { queryTimestamp: args.config.recall.queryTimestamp }
            : {}),
          ...(scope.tags ? { tags: scope.tags } : {}),
          ...(scope.tagsMatch ? { tagsMatch: scope.tagsMatch } : {}),
        }),
      );
      const results = filterRecallQuality(textFromRecallResponse(response)).items;
      blocks.push({
        bankId: scope.bankId,
        query,
        results,
        memoryCount: results.length,
        rendered: "",
      });
    } catch (error) {
      failures.push({
        bankId: scope.bankId,
        query,
        error: redactError(error),
        ...(scope.kind ? { kind: scope.kind } : {}),
        ...(scope.tags ? { tags: scope.tags } : {}),
        ...(scope.tagsMatch ? { tagsMatch: scope.tagsMatch } : {}),
      });
    }
  }
  const rendered = renderRecallBlocks(blocks, args.config.recall.topK);
  return {
    rendered,
    blocks: blocks.map((block) => ({ ...block, rendered })),
    failed: failures.length,
    failures,
  };
}
