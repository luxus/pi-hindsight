import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createSeedImportOperations } from "../extensions/seed-import-operations.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(): HindsightLikeClient {
  return {
    retain: vi.fn(async () => ({ ok: true })),
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("seed content import", () => {
  it("previews deterministic replace imports for markdown, text, and JSON files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-seed-"));
    await writeFile(join(cwd, "README.md"), "# Seed\n");
    await writeFile(join(cwd, "notes.txt"), "notes\n");
    await writeFile(join(cwd, "data.json"), JSON.stringify({ ok: true }));
    await writeFile(join(cwd, "skip.log"), "skip\n");
    const ops = createSeedImportOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const result = await ops.importSeedContent({
      cwd,
      paths: ["."],
      dryRun: true,
      tags: ["seed:test"],
    });

    expect(result.bankId).toBe("project-bank");
    expect(result.dryRun).toBe(true);
    expect(result.documents.map((doc) => doc.sourceFile)).toEqual([
      "README.md",
      "data.json",
      "notes.txt",
    ]);
    expect(result.documents.map((doc) => doc.documentId)).toEqual([
      "pi-seed-import:README.md",
      "pi-seed-import:data.json",
      "pi-seed-import:notes.txt",
    ]);
    expect(result.tags).toContain("import:seed-content");
    expect(result.tags).toContain("seed:test");
    expect(result.documents.every((doc) => doc.wouldWrite === false)).toBe(true);
  });

  it("rejects seed paths outside cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-seed-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-hindsight-outside-"));
    await writeFile(join(outside, "secret.md"), "secret\n");
    const ops = createSeedImportOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await expect(
      ops.importSeedContent({ cwd, paths: [join(outside, "secret.md")], dryRun: true }),
    ).rejects.toThrow("Seed-content import path must stay within cwd");
  });
});
