import { describe, expect, it } from "vitest";
import { getBuiltInBankTemplate } from "../extensions/bank-template-catalog.js";
import {
  buildBankTemplateEditorFields,
  mentalModelTagWarnings,
  updateBankTemplateField,
  validateBankTemplateManifestForEditing,
} from "../extensions/bank-template-editor.js";

describe("bank template editor", () => {
  it("builds reusable editor fields from a template manifest", () => {
    const manifest = getBuiltInBankTemplate("coding-project").manifest;

    expect(buildBankTemplateEditorFields(manifest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "retain_mission",
          label: "Retain mission",
          kind: "text",
          value: expect.stringContaining("technical decisions"),
        }),
        expect.objectContaining({
          id: "enable_observations",
          kind: "boolean",
          value: "true",
        }),
        expect.objectContaining({
          id: "retain_extraction_mode",
          kind: "select",
          choices: ["", "concise", "verbose", "custom", "chunks"],
        }),
      ]),
    );
  });

  it("updates bank fields without mutating the original manifest", () => {
    const manifest = getBuiltInBankTemplate("coding-project").manifest;

    const updated = updateBankTemplateField(manifest, "disposition_skepticism", "4");

    expect(manifest.bank?.disposition_skepticism).toBeUndefined();
    expect(updated.bank?.disposition_skepticism).toBe(4);
    expect(updateBankTemplateField(updated, "retain_extraction_mode", "").bank).not.toHaveProperty(
      "retain_extraction_mode",
    );
  });

  it("validates bank fields and mental model shape", () => {
    const manifest = {
      version: "1" as const,
      mental_models: [
        { id: "Bad ID", name: "", source_query: "", max_tokens: 32 },
        { id: "good-id", name: "Good", source_query: "What matters?", max_tokens: 2048 },
      ],
    };

    expect(() => updateBankTemplateField(manifest, "disposition_empathy", "8")).toThrow(
      "Disposition empathy must be an integer from 1 to 5",
    );
    expect(validateBankTemplateManifestForEditing(manifest)).toEqual([
      'Mental model id "Bad ID" must be lowercase alphanumeric with hyphens.',
      "Mental model Bad ID name is required.",
      "Mental model Bad ID source query is required.",
      "Mental model Bad ID max_tokens must be an integer from 256 to 8192.",
    ]);
  });

  it("returns validation errors for malformed custom manifest shapes", () => {
    expect(
      validateBankTemplateManifestForEditing({
        version: "1",
        bank: [] as never,
        mental_models: {} as never,
        directives: {} as never,
      }),
    ).toEqual([
      "bank must be an object.",
      "mental_models must be an array.",
      "directives must be an array.",
    ]);

    expect(
      validateBankTemplateManifestForEditing({
        version: "1",
        mental_models: [
          {} as never,
          "nope" as never,
          { id: "dup", name: "One", source_query: "Q" },
          { id: "dup", name: "Two", source_query: "Q" },
        ],
        directives: [
          {} as never,
          { name: "rule", content: "Be safe", priority: 1.5, is_active: "yes" as never },
        ],
      }),
    ).toEqual([
      "Mental model id undefined must be lowercase alphanumeric with hyphens.",
      "Mental model #1 name is required.",
      "Mental model #1 source query is required.",
      "Mental model #2 must be an object.",
      "Duplicate mental model id: dup.",
      "Directive #1 name is required.",
      "Directive #1 content is required.",
      "Directive rule priority must be an integer.",
      "Directive rule is_active must be boolean.",
    ]);
  });

  it("warns when mental model tags constrain refresh source memories", () => {
    expect(
      mentalModelTagWarnings({
        version: "1",
        mental_models: [
          {
            id: "user-profile",
            name: "User Profile",
            source_query: "What does user prefer?",
            tags: ["profile:user"],
          },
        ],
      }),
    ).toEqual([
      "Mental model user-profile has tags (profile:user); refresh only reads memories with compatible tags.",
    ]);
  });
});
