import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { composeScopedTagFilter, scopeTagsForBank } from "./memory-scope.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import { readLastRecallSnapshot, resolveLastRecallPath } from "../lifecycle/recall-visibility.js";
import {
  pruneTranscriptRecallBlocks,
  scanTranscriptForRecallBlocks,
} from "../lifecycle/recall-cleanup.js";
import {
  getEffectiveSessionMemoryMode,
  readSessionMemoryMeta,
} from "../utils/session-memory-meta.js";
import type { HindsightTagGroup, TagsMatch } from "../types.js";
import type { MinScores } from "@vectorize-io/hindsight-client";

interface ExplicitRecallFilters {
  budget?: import("../types.js").Budget;
  maxTokens?: number;
  queryTimestamp?: string;
  types?: string[];
  preferObservations?: boolean;
  minScores?: MinScores;
  trace?: boolean;
  includeEntities?: boolean;
  maxEntityTokens?: number;
  includeChunks?: boolean;
  maxChunkTokens?: number;
  includeSourceFacts?: boolean;
  maxSourceFactsTokens?: number;
  tags?: string[];
  tagsMatch?: TagsMatch;
  tagGroups?: HindsightTagGroup[];
  signal?: AbortSignal;
}

interface ExplicitReflectFilters extends Omit<ExplicitRecallFilters, "queryTimestamp" | "types"> {
  includeFacts?: boolean;
  includeToolCalls?: boolean;
  includeToolCallOutput?: boolean;
  factTypes?: Array<"world" | "experience" | "observation">;
  excludeMentalModels?: boolean;
  excludeMentalModelIds?: string[];
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
      const scopeTags = scopeTagsForBank(cwd, config, bankId);
      const result = await deps.getClient().recall(bankId, query, {
        budget: filters.budget ?? config.recall.budget,
        maxTokens: filters.maxTokens ?? config.recall.maxTokens,
        ...(filters.queryTimestamp || config.recall.queryTimestamp
          ? { queryTimestamp: filters.queryTimestamp ?? config.recall.queryTimestamp }
          : {}),
        ...(filters.types ? { types: filters.types } : {}),
        preferObservations: config.recall.preferObservations,
        ...(filters.preferObservations !== undefined
          ? { preferObservations: filters.preferObservations }
          : {}),
        ...(filters.minScores !== undefined ? { minScores: filters.minScores } : {}),
        ...(filters.trace !== undefined ? { trace: filters.trace } : {}),
        ...(filters.includeEntities !== undefined
          ? { includeEntities: filters.includeEntities }
          : {}),
        ...(filters.maxEntityTokens !== undefined
          ? { maxEntityTokens: filters.maxEntityTokens }
          : {}),
        ...(filters.includeChunks !== undefined ? { includeChunks: filters.includeChunks } : {}),
        ...(filters.maxChunkTokens !== undefined ? { maxChunkTokens: filters.maxChunkTokens } : {}),
        ...(filters.includeSourceFacts !== undefined
          ? { includeSourceFacts: filters.includeSourceFacts }
          : {}),
        ...(filters.maxSourceFactsTokens !== undefined
          ? { maxSourceFactsTokens: filters.maxSourceFactsTokens }
          : {}),
        ...composeScopedTagFilter(scopeTags, filters),
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
      filters: ExplicitReflectFilters = {},
    ) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const scopeTags = scopeTagsForBank(cwd, config, bankId);
      const result = await deps.getClient().reflect(bankId, query, {
        ...(context ? { context } : {}),
        budget: filters.budget ?? config.recall.budget,
        ...(filters.maxTokens !== undefined ? { maxTokens: filters.maxTokens } : {}),
        ...(responseSchema ? { responseSchema } : {}),
        ...(filters.includeFacts !== undefined ? { includeFacts: filters.includeFacts } : {}),
        ...(filters.includeToolCalls !== undefined
          ? { includeToolCalls: filters.includeToolCalls }
          : {}),
        ...(filters.includeToolCallOutput !== undefined
          ? { includeToolCallOutput: filters.includeToolCallOutput }
          : {}),
        ...(filters.factTypes ? { factTypes: filters.factTypes } : {}),
        ...(filters.excludeMentalModels !== undefined
          ? { excludeMentalModels: filters.excludeMentalModels }
          : {}),
        ...(filters.excludeMentalModelIds
          ? { excludeMentalModelIds: filters.excludeMentalModelIds }
          : {}),
        ...composeScopedTagFilter(scopeTags, filters),
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
