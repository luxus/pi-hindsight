import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { isMemorySetupComplete, setupRequiredMessage } from "../extensions/config/setup-gate.js";
import type { ResolvedConfig } from "../extensions/types.js";

function config(patch: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...DEFAULT_CONFIG, ...patch };
}

describe("setup gate", () => {
  it("blocks pure first-run defaults with no config or runtime state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-fresh-"));
    expect(isMemorySetupComplete(config(), cwd)).toBe(false);
    expect(setupRequiredMessage()).toMatch(/setup required/i);
  });

  it("accepts explicit setupComplete flag", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-flag-"));
    expect(isMemorySetupComplete(config({ setupComplete: true }), cwd)).toBe(true);
  });

  it("accepts explicit project bankId", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-bank-"));
    expect(
      isMemorySetupComplete(
        config({
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { enabled: true, bankId: "my-bank", derive: "manual" },
          },
        }),
        cwd,
      ),
    ).toBe(true);
  });

  it("accepts user bankId as configured", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-user-"));
    expect(
      isMemorySetupComplete(
        config({
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { enabled: false, derive: "repo" },
            user: { enabled: true, bankId: "life-bank" },
            global: { enabled: true, bankId: "life-bank" },
          },
        }),
        cwd,
      ),
    ).toBe(true);
  });

  it("migrates upgrades that already have project config files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-cfg-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    expect(isMemorySetupComplete(config(), cwd)).toBe(true);
  });

  it("migrates upgrades that have retain runtime state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-runtime-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight", "retain-cursors.json"), "{}\n");
    expect(isMemorySetupComplete(config(), cwd)).toBe(true);
  });
});
