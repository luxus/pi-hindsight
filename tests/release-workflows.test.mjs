import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

for (const workflow of [".github/workflows/release.yml", ".github/workflows/release-please.yml"]) {
  describe(workflow, () => {
    it("skips npm publish when the package version already exists", () => {
      const content = readFileSync(workflow, "utf8");
      expect(content).toContain('npm view "$name@$version" version');
      expect(content).toContain("already exists on npm; skipping publish");
      expect(content).toContain("npm publish --provenance --access public");
    });
  });
}
