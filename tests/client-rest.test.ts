import { describe, expect, it } from "vitest";
import {
  assertHealthResponse,
  assertReflectResponse,
  bankConfigPath,
  bankTemplateExportPath,
  bankTemplateImportPath,
  createMentalModelRequestBody,
  encodeBankPath,
  mentalModelCollectionPath,
  mentalModelHistoryPath,
  mentalModelItemPath,
  mentalModelRefreshPath,
  reflectRequestBody,
  updateBankConfigRequestBody,
  updateMentalModelRequestBody,
} from "../extensions/client-rest.js";

describe("Hindsight REST transport helpers", () => {
  it("maps reflect response schema options to Hindsight REST request shape", () => {
    expect(
      reflectRequestBody("query", {
        context: "ctx",
        budget: "mid",
        responseSchema: { type: "object" },
        tags: ["source:pi"],
        tagsMatch: "any_strict",
      }),
    ).toEqual({
      query: "query",
      context: "ctx",
      budget: "mid",
      response_schema: { type: "object" },
      tags: ["source:pi"],
      tags_match: "any_strict",
    });
  });

  it("encodes bank ids in REST paths", () => {
    expect(encodeBankPath("bank/id", "/reflect")).toBe("/v1/default/banks/bank%2Fid/reflect");
    expect(bankConfigPath("bank/id")).toBe("/v1/default/banks/bank%2Fid/config");
    expect(bankTemplateImportPath("bank/id", { dryRun: true })).toBe(
      "/v1/default/banks/bank%2Fid/import?dry_run=true",
    );
    expect(bankTemplateExportPath("bank/id")).toBe("/v1/default/banks/bank%2Fid/export");
    expect(
      updateBankConfigRequestBody({ retain_custom_instructions: "Extract carefully" }),
    ).toEqual({
      updates: { retain_custom_instructions: "Extract carefully" },
    });
  });

  it("maps mental model paths and query options to Hindsight REST shape", () => {
    expect(
      mentalModelCollectionPath("bank/id", {
        tags: ["project", "stable"],
        tagsMatch: "all",
        detail: "metadata",
        limit: 10,
        offset: 5,
      }),
    ).toBe(
      "/v1/default/banks/bank%2Fid/mental-models?tags=project&tags=stable&tags_match=all&detail=metadata&limit=10&offset=5",
    );
    expect(mentalModelItemPath("bank/id", "model/id", { detail: "full" })).toBe(
      "/v1/default/banks/bank%2Fid/mental-models/model%2Fid?detail=full",
    );
    expect(mentalModelHistoryPath("bank/id", "model/id")).toBe(
      "/v1/default/banks/bank%2Fid/mental-models/model%2Fid/history",
    );
    expect(mentalModelRefreshPath("bank/id", "model/id")).toBe(
      "/v1/default/banks/bank%2Fid/mental-models/model%2Fid/refresh",
    );
  });

  it("maps mental model request bodies to OpenAPI field names", () => {
    expect(
      createMentalModelRequestBody({
        id: "team-style",
        name: "Team Style",
        sourceQuery: "How does the team prefer to work?",
        tags: ["team"],
        maxTokens: 2048,
        trigger: {
          mode: "delta",
          refresh_after_consolidation: false,
          fact_types: ["world", "observation"],
          exclude_mental_models: true,
          exclude_mental_model_ids: ["old-model"],
          tags_match: "all_strict",
          tag_groups: [{ and: ["project", "stable"] }],
          include_chunks: false,
          recall_max_tokens: 1024,
          recall_chunks_max_tokens: 256,
        },
      }),
    ).toEqual({
      id: "team-style",
      name: "Team Style",
      source_query: "How does the team prefer to work?",
      tags: ["team"],
      max_tokens: 2048,
      trigger: {
        mode: "delta",
        refresh_after_consolidation: false,
        fact_types: ["world", "observation"],
        exclude_mental_models: true,
        exclude_mental_model_ids: ["old-model"],
        tags_match: "all_strict",
        tag_groups: [{ and: ["project", "stable"] }],
        include_chunks: false,
        recall_max_tokens: 1024,
        recall_chunks_max_tokens: 256,
      },
    });
    expect(updateMentalModelRequestBody({ sourceQuery: "New query", tags: null })).toEqual({
      source_query: "New query",
      tags: null,
    });
  });

  it("asserts REST fallback response shapes", () => {
    expect(assertHealthResponse({ status: "ok" })).toEqual({ status: "ok" });
    expect(assertHealthResponse(null)).toEqual({});
    expect(assertHealthResponse("ok")).toEqual({});
    expect(assertReflectResponse({ text: "answer" })).toEqual({ text: "answer" });
    expect(() => assertReflectResponse(null)).toThrow("non-object response");
  });
});
