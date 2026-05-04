import { describe, expect, it } from "vitest";
import {
  BUILT_IN_BANK_TEMPLATES,
  cloneBankTemplateManifest,
  defaultBankTemplateForTarget,
  getBuiltInBankTemplate,
  isBankTemplateProfileId,
  summarizeBankTemplateManifest,
} from "../extensions/bank-template-catalog.js";

describe("bank template catalog", () => {
  it("defines stable built-in template ids", () => {
    expect(BUILT_IN_BANK_TEMPLATES.map((template) => template.id)).toEqual([
      "coding-project",
      "assistant-personal",
      "general-user",
    ]);
    expect(defaultBankTemplateForTarget("project").id).toBe("coding-project");
    expect(defaultBankTemplateForTarget("user").id).toBe("general-user");
  });

  it("ships valid version 1 manifests with stable mental model ids", () => {
    for (const template of BUILT_IN_BANK_TEMPLATES) {
      expect(template.manifest.version).toBe("1");
      expect(template.manifest.bank?.retain_mission).toEqual(expect.any(String));
      expect(template.manifest.bank?.reflect_mission).toEqual(expect.any(String));
      expect(template.manifest.bank?.enable_observations).toBe(true);
      expect(template.manifest.bank?.observations_mission).toEqual(expect.any(String));
      expect(template.manifest.mental_models).toHaveLength(2);
      for (const model of template.manifest.mental_models ?? []) {
        expect(model.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(model.name).toEqual(expect.any(String));
        expect(model.source_query).toEqual(expect.any(String));
        expect(model.max_tokens).toBeGreaterThanOrEqual(256);
        expect(model.max_tokens).toBeLessThanOrEqual(8192);
        expect(model.trigger).toMatchObject({
          refresh_after_consolidation: true,
          mode: "full",
        });
      }
    }
  });

  it("gets, narrows, clones, and summarizes templates", () => {
    expect(isBankTemplateProfileId("coding-project")).toBe(true);
    expect(isBankTemplateProfileId("unknown")).toBe(false);
    expect(() => getBuiltInBankTemplate("unknown" as never)).toThrow(
      "Unknown built-in bank template",
    );

    const template = getBuiltInBankTemplate("coding-project");
    const cloned = cloneBankTemplateManifest(template.manifest);
    cloned.bank!.retain_mission = "Changed";

    expect(template.manifest.bank?.retain_mission).not.toBe("Changed");
    expect(summarizeBankTemplateManifest(template.manifest)).toEqual({
      version: "1",
      bankOverrideCount: 4,
      mentalModelCount: 2,
      directiveCount: 0,
    });
  });
});
