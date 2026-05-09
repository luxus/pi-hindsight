import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(".release-please-config.json", "utf8"));

describe("release-please config", () => {
  it("keeps runtime version metadata release-managed", () => {
    expect(config.packages["."]["extra-files"]).toContain("extensions/version.ts");
  });
});
