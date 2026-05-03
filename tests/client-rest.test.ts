import { describe, expect, it } from "vitest";
import {
  assertHealthResponse,
  assertReflectResponse,
  encodeBankPath,
  reflectRequestBody,
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
  });

  it("asserts REST fallback response shapes", () => {
    expect(assertHealthResponse({ status: "ok" })).toEqual({ status: "ok" });
    expect(assertHealthResponse(null)).toEqual({});
    expect(assertHealthResponse("ok")).toEqual({});
    expect(assertReflectResponse({ text: "answer" })).toEqual({ text: "answer" });
    expect(() => assertReflectResponse(null)).toThrow("non-object response");
  });
});
