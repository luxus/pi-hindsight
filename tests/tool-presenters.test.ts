import { describe, expect, it } from "vitest";
import { getBankTemplateSchemaToolResponse } from "../extensions/tool-presenters.js";

describe("tool presenters", () => {
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
