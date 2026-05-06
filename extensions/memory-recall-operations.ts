import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { recallScopeTags } from "./banking.js";
import { resolveOperationBank } from "./bank-selection.js";
import { readLastRecallSnapshot, resolveLastRecallPath } from "./recall-visibility.js";
import { pruneTranscriptRecallBlocks, scanTranscriptForRecallBlocks } from "./recall-cleanup.js";
import { getEffectiveSessionMemoryMode, readSessionMemoryMeta } from "./session-memory-meta.js";
import type { HindsightTagGroup, ResolvedConfig, TagsMatch } from "./types.js";

interface ExplicitRecallFilters {
  queryTimestamp?: string;
  tags?: string[];
  tagsMatch?: TagsMatch;
  tagGroups?: HindsightTagGroup[];
  signal?: AbortSignal;
}

function recallTagsForBank(
  cwd: string,
  config: ResolvedConfig,
  projectBankId: string,
  bankId: string,
): string[] {
  return config.banks.user.enabled && bankId === config.banks.user.bankId
    ? ["source:pi"]
    : recallScopeTags(cwd);
}

function scopedTagFilterOptions(scopeTags: string[], filters: ExplicitRecallFilters = {}) {
  const scopeGroup = { tags: scopeTags, match: "any_strict" } satisfies HindsightTagGroup;
  const callerGroups = filters.tagGroups ?? [];
  if (callerGroups.length || filters.tags?.length) {
    const flatTagGroup = filters.tags?.length
      ? [
          {
            tags: filters.tags,
            match: filters.tagsMatch ?? "any_strict",
          } satisfies HindsightTagGroup,
        ]
      : [];
    return { tagGroups: [scopeGroup, ...flatTagGroup, ...callerGroups] };
  }
  return { tags: scopeTags, tagsMatch: "any_strict" as const };
}

export function createRecallOperations(deps: MemoryOperationsDeps) {
  return {
    async recall(
      cwd: string,
      query: string,
      bank?: string,
      sessionFile?: string,
      filters: ExplicitRecallFilters = {},
    ) {
      const meta = await readSessionMemoryMeta(cwd, sessionFile);
      if (!getEffectiveSessionMemoryMode(meta).recall)
        throw new Error("Hindsight recall is disabled for this session");
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const scopeTags = recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId);
      const result = await deps.getClient().recall(bankId, query, {
        budget: config.recall.budget,
        maxTokens: config.recall.maxTokens,
        ...(filters.queryTimestamp || config.recall.queryTimestamp
          ? { queryTimestamp: filters.queryTimestamp ?? config.recall.queryTimestamp }
          : {}),
        ...scopedTagFilterOptions(scopeTags, filters),
        ...(filters.signal ? { signal: filters.signal } : {}),
      });
      return { bankId, result };
    },

    async reflect(
      cwd: string,
      query: string,
      context?: string,
      bank?: string,
      responseSchema?: Record<string, unknown>,
      filters: Omit<ExplicitRecallFilters, "queryTimestamp"> = {},
    ) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const scopeTags = recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId);
      const result = await deps.getClient().reflect(bankId, query, {
        ...(context ? { context } : {}),
        budget: config.recall.budget,
        ...(responseSchema ? { responseSchema } : {}),
        ...scopedTagFilterOptions(scopeTags, filters),
        ...(filters.signal ? { signal: filters.signal } : {}),
      });
      return { bankId, result };
    },

    async lastRecall(cwd: string) {
      const config = deps.getConfig();
      const path = resolveLastRecallPath(cwd, config.recall.lastRecallPath);
      const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
      return { path, snapshot };
    },

    async recallCleanup(sessionFile: string, prune: boolean) {
      return prune
        ? pruneTranscriptRecallBlocks(sessionFile)
        : scanTranscriptForRecallBlocks(sessionFile);
    },
  };
}
