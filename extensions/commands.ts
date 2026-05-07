import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryOperationsDeps } from "./memory-operation-service.js";
import { createOperationCatalog } from "./operation-catalog.js";

export function registerCommands(pi: ExtensionAPI, deps: MemoryOperationsDeps) {
  for (const command of createOperationCatalog(deps).commands) {
    pi.registerCommand(command.name, command.spec);
  }
}
