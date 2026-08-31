import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OperationCatalog } from "./operation-catalog.js";

export function registerTools(pi: ExtensionAPI, catalog: OperationCatalog) {
  for (const tool of catalog.tools) pi.registerTool(tool);
}
