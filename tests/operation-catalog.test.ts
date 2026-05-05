import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createOperationCatalog } from "../extensions/operation-catalog.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    getBankConfig: async () => ({ config: {}, overrides: {} }),
    resetBankConfig: async () => ({ ok: true }),
    getBankTemplateSchema: async () => ({ title: "BankTemplateManifest", properties: {} }),
    listDirectives: async () => ({ items: [] }),
    getDirective: async () => ({ id: "directive", name: "Rule", content: "Use facts." }),
    createDirective: async () => ({ id: "directive", name: "Rule", content: "Use facts." }),
    updateDirective: async () => ({ id: "directive", name: "Rule", content: "Updated." }),
    deleteDirective: async () => ({ deleted: true }),
    exportBankTemplate: async () => ({ version: "1" }),
  };
}

describe("operation catalog", () => {
  it("passes nullable directive updates through the public tool surface", async () => {
    const updateDirective = vi.fn(async () => ({ id: "directive", content: "Updated" }));
    const catalog = createOperationCatalog({
      getClient: () => ({ ...client(), updateDirective }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });
    const tool = catalog.tools.find((candidate) => candidate.name === "hindsight_update_directive");

    await tool?.execute(
      "call",
      { directiveId: "directive", bank: "target-bank", content: null, tags: null },
      new AbortController().signal,
      () => undefined,
      { cwd: "/repo", sessionManager: {} } as never,
    );

    expect(updateDirective).toHaveBeenCalledWith("target-bank", "directive", {
      content: null,
      tags: null,
    });
  });

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
      "hindsight_get_bank_config",
      "hindsight_reset_bank_config",
      "hindsight_list_directives",
      "hindsight_get_directive",
      "hindsight_create_directive",
      "hindsight_update_directive",
      "hindsight_delete_directive",
      "hindsight_get_bank_template_schema",
      "hindsight_export_bank_template",
      "hindsight_import",
      "hindsight_import_gateway",
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
