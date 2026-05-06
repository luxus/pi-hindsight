import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { flushRetain } from "./retain-queue.js";
import { resolveOperationBank } from "./bank-selection.js";
import { explicitMemoryDocumentId } from "./session.js";
import { createMemoryIdentity, explicitRetainTags } from "./memory-identity.js";
import { expandObservationScopes } from "./observation-scopes.js";
import { retainDurably } from "./retain-durable.js";
import { appendRetainReceipt, listRetainReceipts } from "./retain-receipts.js";
import { getEffectiveSessionMemoryMode, readSessionMemoryMeta } from "./session-memory-meta.js";
import type { ResolvedConfig, UpdateMode } from "./types.js";

export function createRetainOperations(deps: MemoryOperationsDeps) {
  return {
    async retainExplicit(args: {
      cwd: string;
      sessionFile?: string;
      content: string;
      context: string;
      bank?: string;
      tags?: string[];
      entities?: ResolvedConfig["retain"]["entities"];
      documentId?: string;
      timestamp?: string;
      metadata?: Record<string, string>;
      updateMode?: UpdateMode;
      observationScopes?: string[][];
      async?: boolean;
    }) {
      const meta = await readSessionMemoryMeta(args.cwd, args.sessionFile);
      if (!getEffectiveSessionMemoryMode(meta).retain)
        throw new Error("Hindsight retain is disabled for this session");
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const tags = explicitRetainTags(args.cwd, args.sessionFile, [
        ...(args.tags ?? []),
        ...meta.tags,
      ]);
      const capabilities = deps.getCapabilities?.();
      const identity = createMemoryIdentity(args.cwd, config, args.sessionFile);
      const defaultObservationScopes = config.observations.enabled
        ? expandObservationScopes(config.observations.scopes, {
            ...identity,
            projectBankId: bankId,
          })
        : [];
      const observationScopes = args.observationScopes ?? defaultObservationScopes;
      const result = await retainDurably({
        cwd: args.cwd,
        config,
        client: deps.getClient(),
        bankId,
        content: args.content,
        context: args.context,
        tags,
        updateMode: args.updateMode ?? "replace",
        documentId:
          args.documentId ??
          explicitMemoryDocumentId({
            cwd: args.cwd,
            ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
            bankId,
            content: args.content,
            context: args.context,
          }),
        metadata: {
          ...args.metadata,
          cwd: args.cwd,
          ...(args.sessionFile ? { pi_session_file: args.sessionFile } : {}),
        },
        ...(args.timestamp ? { timestamp: args.timestamp } : {}),
        source: "tool",
        ...(observationScopes.length ? { observationScopes } : {}),
        ...(args.entities?.length ? { entities: args.entities } : {}),
        ...(args.async !== undefined ? { async: args.async } : {}),
        ...(capabilities ? { capabilities } : {}),
      });
      const response = { ...result, tags, queued: result.enqueued };
      await appendRetainReceipt(args.cwd, {
        bankId: result.bankId,
        documentId: result.documentId,
        queueJobId: result.queueJobId,
        updateMode: result.updateMode,
        source: "tool",
        context: args.context,
        tags,
      });
      return response;
    },

    async listRetainReceipts(cwd: string, limit?: number) {
      return listRetainReceipts(cwd, limit);
    },

    async flush(cwd: string) {
      return flushRetain(cwd, deps.getConfig(), deps.getClient());
    },
  };
}
