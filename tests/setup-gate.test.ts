import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  isMemorySetupComplete,
  requiresExplicitCodingBankId,
  setupRequiredMessage,
} from "../extensions/config/setup-gate.js";
import type { ResolvedConfig } from "../extensions/types.js";

function config(patch: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    scope: { ...DEFAULT_CONFIG.scope, ...(patch as { scope?: object }).scope },
    banks: {
      ...DEFAULT_CONFIG.banks,
      ...(patch.banks ?? {}),
      project: { ...DEFAULT_CONFIG.banks.project, ...(patch.banks?.project ?? {}) },
      user: { ...DEFAULT_CONFIG.banks.user, ...(patch.banks?.user ?? {}) },
    },
  } as ResolvedConfig;
}

describe("setup gate", () => {
  it("blocks pure first-run defaults with no config or runtime state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-fresh-"));
    expect(isMemorySetupComplete(config(), cwd)).toBe(false);
    expect(setupRequiredMessage()).toMatch(/setup required/i);
  });

  it("points setup-required copy at upgrade guide, dual-tag docs, and changelog", () => {
    const message = setupRequiredMessage();
    expect(message).toMatch(/setup required/i);
    expect(message).toContain(
      "https://luxus.github.io/pi-hindsight/guides/upgrading-to-domain-banks/",
    );
    expect(message).toContain("https://luxus.github.io/pi-hindsight/concepts/project-identity/");
    expect(message).toContain("https://github.com/luxus/pi-hindsight/blob/main/CHANGELOG.md");
  });

  it("rejects setupComplete alone under domain-tagged without coding bankId", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-flag-"));
    expect(isMemorySetupComplete(config({ setupComplete: true }), cwd)).toBe(false);
    expect(requiresExplicitCodingBankId(config())).toBe(true);
  });

  it("accepts setupComplete with explicit project bankId", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-flag-bank-"));
    expect(
      isMemorySetupComplete(
        config({
          setupComplete: true,
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { enabled: true, bankId: "my-bank", derive: "manual" },
          },
        }),
        cwd,
      ),
    ).toBe(true);
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

  it("accepts user bankId as configured when project bank disabled", () => {
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

  it("does not unlock domain-tagged auto memory from empty project config alone", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-cfg-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    // Soft signal present, but domain-tagged still needs banks.project.bankId.
    expect(isMemorySetupComplete(config(), cwd)).toBe(false);
  });

  it("does not unlock domain-tagged auto memory from runtime state alone", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-runtime-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight", "retain-cursors.json"), "{}\n");
    expect(isMemorySetupComplete(config(), cwd)).toBe(false);
  });

  it("allows isolated-bank path-derived setup via config file or runtime state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-setup-isolated-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    expect(
      isMemorySetupComplete(
        config({
          scope: { ...DEFAULT_CONFIG.scope, mode: "isolated-bank" },
        }),
        cwd,
      ),
    ).toBe(true);
  });
});
