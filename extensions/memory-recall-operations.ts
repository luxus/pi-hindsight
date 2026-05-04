import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { recallScopeTags } from "./banking.js";
import { resolveOperationBank } from "./bank-selection.js";
import { readLastRecallSnapshot, resolveLastRecallPath } from "./recall-visibility.js";
import { pruneTranscriptRecallBlocks, scanTranscriptForRecallBlocks } from "./recall-cleanup.js";
import { getEffectiveSessionMemoryMode, readSessionMemoryMeta } from "./session-memory-meta.js";
import type { ResolvedConfig } from "./types.js";

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

export function createRecallOperations(deps: MemoryOperationsDeps) {
  return {
    async recall(
      cwd: string,
      query: string,
      bank?: string,
      sessionFile?: string,
      queryTimestamp?: string,
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
      const result = await deps.getClient().recall(bankId, query, {
        budget: config.recall.budget,
        maxTokens: config.recall.maxTokens,
        ...(queryTimestamp || config.recall.queryTimestamp
          ? { queryTimestamp: queryTimestamp ?? config.recall.queryTimestamp }
          : {}),
        tags: recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId),
        tagsMatch: "any_strict",
      });
      return { bankId, result };
    },

    async reflect(
      cwd: string,
      query: string,
      context?: string,
      bank?: string,
      responseSchema?: Record<string, unknown>,
    ) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const result = await deps.getClient().reflect(bankId, query, {
        ...(context ? { context } : {}),
        budget: config.recall.budget,
        ...(responseSchema ? { responseSchema } : {}),
        tags: recallTagsForBank(cwd, config, deps.getProjectBankId(), bankId),
        tagsMatch: "any_strict",
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
