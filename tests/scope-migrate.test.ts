import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  buildScopeMigratePlan,
  writeScopeMigrateReceipt,
} from "../extensions/operations/scope-migrate.js";
import type { ResolvedConfig } from "../extensions/types.js";

function cfg(patch: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    scope: { ...DEFAULT_CONFIG.scope, ...(patch.scope ?? {}) },
    banks: {
      ...DEFAULT_CONFIG.banks,
      ...(patch.banks ?? {}),
      project: { ...DEFAULT_CONFIG.banks.project, ...(patch.banks?.project ?? {}) },
    },
  };
}

describe("scope migrate dry-run", () => {
  it("plans dual-tag guidance without rewrite and flags path-derived banks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-migrate-"));
    mkdirSync(join(cwd, ".git"));
    const plan = buildScopeMigratePlan({
      cwd,
      config: cfg(),
      projectBankId: "pi-project-demo-abc",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.rewrite).toBe("none");
    expect(plan.dualTagWindow).toBe(true);
    expect(plan.projectTag).toMatch(/^project:/);
    expect(plan.legacyRepoTag).toMatch(/^repo:/);
    expect(plan.pathDerivedBank).toBe(true);
    expect(plan.legacyPathHashTag).toBe(true);
    expect(plan.findings.some((f) => f.includes("path-derived"))).toBe(true);
    expect(plan.guidance.some((g) => /no silent rewrite/i.test(g))).toBe(true);
  });

  it("does not mark remote/pin project ids as identity-weak", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-migrate-stable-"));
    mkdirSync(join(cwd, ".git"));
    // Pin identity is stable; legacy path-hash still noted separately.
    const plan = buildScopeMigratePlan({
      cwd,
      config: cfg({
        scope: { ...DEFAULT_CONFIG.scope, projectId: "finalform", projectIdStrategy: "remote" },
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "kai-coding", derive: "manual" },
        },
      }),
      projectBankId: "kai-coding",
    });
    expect(plan.projectIdBasis).toBe("pin");
    expect(plan.identityBasisWeak).toBe(false);
    expect(plan.legacyPathHashTag).toBe(true);
    expect(plan.findings.some((f) => /stable across absolute path moves/i.test(f))).toBe(true);
    expect(plan.findings.some((f) => /basename-derived/i.test(f))).toBe(false);
  });

  it("counts remote tag sample and detects other path-hash repo tags", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-migrate-tags-"));
    mkdirSync(join(cwd, ".git"));
    const base = buildScopeMigratePlan({
      cwd,
      config: cfg({
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "kai-coding", derive: "manual" },
        },
      }),
      projectBankId: "kai-coding",
    });

    const plan = buildScopeMigratePlan({
      cwd,
      config: cfg({
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "kai-coding", derive: "manual" },
        },
      }),
      projectBankId: "kai-coding",
      bankTags: [
        base.projectTag,
        base.legacyRepoTag,
        "repo:otherhost-deadbeef1234",
        "source:pi",
        base.projectTag,
      ],
    });

    expect(plan.pathDerivedBank).toBe(false);
    expect(plan.remoteTagCounts).toEqual({
      projectTagHits: 2,
      legacyRepoTagHits: 1,
      otherRepoTags: ["repo:otherhost-deadbeef1234"],
      sampleSize: 5,
    });
    expect(plan.findings.some((f) => f.includes("Other path-hash"))).toBe(true);
  });

  it("writes a receipt under .pi/hindsight/", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-migrate-rcpt-"));
    mkdirSync(join(cwd, ".git"));
    const plan = buildScopeMigratePlan({
      cwd,
      config: cfg({ setupComplete: true }),
      projectBankId: "kai-coding",
    });
    const receipt = await writeScopeMigrateReceipt(cwd, plan);
    expect(receipt.receiptPath).toBe(join(cwd, ".pi", "hindsight", "scope-migrate-receipt.json"));
    const raw = JSON.parse(readFileSync(receipt.receiptPath, "utf8")) as { rewrite: string };
    expect(raw.rewrite).toBe("none");
  });
});
