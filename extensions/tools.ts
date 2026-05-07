import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryOperationsDeps } from "./memory-operation-service.js";
import { createOperationCatalog } from "./operation-catalog.js";

export function registerTools(pi: ExtensionAPI, deps: MemoryOperationsDeps) {
  for (const tool of createOperationCatalog(deps).tools) pi.registerTool(tool);
}
