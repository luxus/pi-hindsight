import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const generator = join(repoRoot, "scripts", "generate-code-map.mjs");
const codeMap = join(repoRoot, "docs-site", "src", "content", "docs", "development", "code-map.md");

describe("generated code map", () => {
  it("is fresh against the deterministic generator", () => {
    expect(() => execFileSync(process.execPath, [generator, "--check"])).not.toThrow();
  });

  it("labels itself as derived navigation without secrets or local absolute paths", () => {
    const content = readFileSync(codeMap, "utf8");

    expect(content).toContain("Derived navigation, not authoritative product documentation.");
    expect(content).toContain(
      "No secrets, local absolute paths, raw retained payloads, or queue contents are included.",
    );
    expect(content).not.toMatch(/\/Users\//u);
    expect(content).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/u);
  });
});
