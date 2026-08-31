import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OperationCatalog } from "../operations/operation-catalog.js";

export function registerCommands(pi: ExtensionAPI, catalog: OperationCatalog) {
  for (const command of catalog.commands) {
    pi.registerCommand(command.name, command.spec);
  }
}
