import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { routeMemoryCandidate } from "./memory-router.js";

export function createRoutingOperations(deps: MemoryOperationsDeps) {
  return {
    routeMemory(args: { content: string; context?: string; cwd?: string; sessionFile?: string }) {
      return routeMemoryCandidate({
        content: args.content,
        ...(args.context ? { context: args.context } : {}),
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
      });
    },
  };
}
