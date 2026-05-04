import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createOperationCatalog } from "../extensions/operation-catalog.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    exportBankTemplate: async () => ({ version: "1" }),
  };
}

describe("operation catalog", () => {
  it("declares the public tool and command surface in one catalog", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "hindsight_recall",
      "hindsight_retain",
      "hindsight_retain_global",
      "hindsight_retain_receipts",
      "hindsight_route_memory",
      "hindsight_delete_document",
      "hindsight_configure",
      "hindsight_export_bank_template",
      "hindsight_import",
      "hindsight_reflect",
    ]);

    expect(catalog.commands.map((command) => command.name)).toEqual([
      "hindsight",
      "hindsight:init",
      "hindsight:import",
      "hindsight:import-current",
      "hindsight:import-file",
      "hindsight:import-project-sessions",
      "hindsight:session",
      "hindsight:mode",
      "hindsight:next-opt-out",
      "hindsight:retain",
      "hindsight:tag",
      "hindsight:last-recall",
      "hindsight:recall-cleanup",
      "hindsight:flush",
    ]);
  });
});
