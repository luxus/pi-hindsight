import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import {
  importMemoryChatTranscript,
  importMemoryProjectSessions,
  importMemorySession,
} from "../imports/import-sessions.js";
import { createBankTemplateOperations } from "./memory-bank-template-operations.js";
import { createConfigOperations } from "./memory-config-operations.js";
import { createControlOperations } from "./memory-control-operations.js";
import { createDiagnosticsOperations } from "./memory-diagnostics-operations.js";
import { createQueueOperations } from "../queue/queue-operations.js";
import { createRecallOperations } from "./memory-recall-operations.js";
import { createRetainOperations } from "./memory-retain-operations.js";
import { createSessionOperations } from "./memory-session-operations.js";
import type { ResolvedConfig } from "../types.js";
import type { ImportProgressReporter } from "../imports/import-sessions.js";

export type { ConfigureMemoryArgs, MemoryOperationsDeps } from "./memory-operation-types.js";

function createImportOperations(deps: MemoryOperationsDeps) {
  return {
    async importSession(args: {
      sessionFile: string;
      cwd?: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
      onProgress?: ImportProgressReporter;
    }) {
      return importMemorySession(args, deps);
    },

    async importChatTranscript(args: {
      sourceFile: string;
      cwd: string;
      bank?: string;
      dryRun?: boolean;
      onProgress?: ImportProgressReporter;
    }) {
      return importMemoryChatTranscript(args, deps);
    },

    async importProjectSessions(args: {
      cwd: string;
      currentSessionFile?: string;
      searchDir?: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
      onProgress?: ImportProgressReporter;
    }) {
      return importMemoryProjectSessions(args, deps);
    },
  };
}

export function createMemoryOperations(deps: MemoryOperationsDeps) {
  return {
    ...createRecallOperations(deps),
    ...createRetainOperations(deps),
    ...createConfigOperations(deps),
    ...createImportOperations(deps),
    ...createQueueOperations(deps),
    ...createSessionOperations(),
    ...createDiagnosticsOperations(deps),
    ...createBankTemplateOperations(deps),
    ...createControlOperations(deps),
  };
}

export type MemoryOperations = ReturnType<typeof createMemoryOperations>;
