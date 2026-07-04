import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe(".github/workflows/release-please.yml", () => {
  it("delegates npm publishing to the trusted Release workflow", () => {
    const content = readFileSync(".github/workflows/release-please.yml", "utf8");
    expect(content).toContain("actions: write");
    expect(content).toContain("Dispatch trusted release workflow");
    expect(content).toContain("RELEASE_TAG: ${{ steps.release.outputs.tag_name }}");
    expect(content).toContain('test -n "${RELEASE_TAG}"');
    expect(content).toMatch(
      /gh workflow run release\.yml --ref "\$\{RELEASE_TAG\}" -f publish=(true|false)\b/,
    );
    expect(content).not.toContain("npm publish --provenance --access public");
  });
});

describe(".github/workflows/release.yml", () => {
  it("skips npm publish when the package version already exists", () => {
    const content = readFileSync(".github/workflows/release.yml", "utf8");
    expect(content).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.publish == 'true'",
    );
    expect(content).toContain('npm view "$name@$version" version');
    expect(content).toContain("already exists on npm; skipping publish");
    expect(content).toContain("npm publish --provenance --access public");
  });
});
