import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { importMemoryProjectSessions, importMemorySession } from "./import-operations.js";
import { createBankTemplateOperations } from "./bank-template-operations.js";
import { createConfigOperations } from "./memory-config-operations.js";
import { createDocumentOperations } from "./memory-document-operations.js";
import { createRecallOperations } from "./memory-recall-operations.js";
import { createRetainOperations } from "./memory-retain-operations.js";
import { createRoutingOperations } from "./memory-routing-operations.js";
import { createSessionOperations } from "./memory-session-operations.js";
import type { ResolvedConfig } from "./types.js";

export type { ConfigureMemoryArgs, MemoryOperationsDeps } from "./memory-operation-types.js";

function createImportOperations(deps: MemoryOperationsDeps) {
  return {
    async importSession(args: {
      sessionFile: string;
      cwd?: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
    }) {
      return importMemorySession(args, deps);
    },

    async importProjectSessions(args: {
      cwd: string;
      currentSessionFile?: string;
      searchDir?: string;
      bank?: string;
      dryRun?: boolean;
      includeBranches?: ResolvedConfig["import"]["includeBranches"];
    }) {
      return importMemoryProjectSessions(args, deps);
    },
  };
}

export function createMemoryOperations(deps: MemoryOperationsDeps) {
  return {
    ...createRecallOperations(deps),
    ...createRetainOperations(deps),
    ...createDocumentOperations(deps),
    ...createRoutingOperations(deps),
    ...createConfigOperations(deps),
    ...createBankTemplateOperations(deps),
    ...createImportOperations(deps),
    ...createSessionOperations(),
  };
}

export type MemoryOperations = ReturnType<typeof createMemoryOperations>;
