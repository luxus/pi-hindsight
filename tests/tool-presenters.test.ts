import { describe, expect, it } from "vitest";
import {
  createDirectiveToolResponse,
  deleteDirectiveToolResponse,
  getBankTemplateSchemaToolResponse,
  getDirectiveToolResponse,
  listDirectivesToolResponse,
  updateDirectiveToolResponse,
} from "../extensions/tool-presenters.js";

describe("tool presenters", () => {
  it("presents directive tool results", () => {
    const list = listDirectivesToolResponse({
      bankId: "bank",
      result: {
        items: [
          { id: "directive-1", name: "Rule", content: "Use facts.", is_active: false, priority: 3 },
        ],
      },
    });
    expect(list.content[0]?.text).toContain("Directives in bank: 1");
    expect(list.content[0]?.text).toContain("Rule (directive-1) · inactive · priority 3");

    expect(
      getDirectiveToolResponse({
        bankId: "bank",
        directiveId: "directive-1",
        result: { id: "directive-1" },
      }).content[0]?.text,
    ).toContain("Directive directive-1 in bank.");
    expect(
      createDirectiveToolResponse({ bankId: "bank", result: { id: "directive-2" } }).content[0]
        ?.text,
    ).toContain("Created directive in bank.");
    expect(
      updateDirectiveToolResponse({
        bankId: "bank",
        directiveId: "directive-2",
        result: { id: "directive-2" },
      }).content[0]?.text,
    ).toContain("Updated directive directive-2 in bank.");
    expect(
      deleteDirectiveToolResponse({
        bankId: "bank",
        directiveId: "directive-2",
        result: { deleted: true },
      }).content[0]?.text,
    ).toContain("Deleted directive directive-2 in bank.");
  });

  it("presents bank template schema summary and raw JSON", () => {
    const result = {
      schema: {
        title: "BankTemplateManifest",
        properties: {
          version: { type: "string" },
          bank: { type: "object" },
        },
      },
    };

    const response = getBankTemplateSchemaToolResponse(result);

    expect(response.details).toBe(result);
    expect(response.content[0]?.text).toContain("Fetched Hindsight bank template JSON Schema.");
    expect(response.content[0]?.text).toContain("BankTemplateManifest; top-level fields: 2");
    expect(response.content[0]?.text).toContain('"version"');
  });
});
