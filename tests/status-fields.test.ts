import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { buildStatusFields, formatStatusFieldsText } from "../extensions/utils/status-fields.js";
import type { ResolvedConfig } from "../extensions/types.js";

function config(patch: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    scope: { ...DEFAULT_CONFIG.scope, ...(patch as { scope?: object }).scope },
    banks: { ...DEFAULT_CONFIG.banks, ...(patch.banks ?? {}) },
    recall: { ...DEFAULT_CONFIG.recall, ...(patch.recall ?? {}) },
    retain: { ...DEFAULT_CONFIG.retain, ...(patch.retain ?? {}) },
  } as ResolvedConfig;
}

describe("status fields tones", () => {
  it("warns when setup is incomplete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-status-fresh-"));
    const fields = buildStatusFields(config(), {
      cwd,
      projectBankId: "pi-project-x",
    });
    const setup = fields.find((f) => f.key === "setup");
    expect(setup?.value).toBe("required");
    expect(setup?.tone).toBe("warn");
  });

  it("marks non-default bank id and maxTokens as custom", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-status-cfg-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    const fields = buildStatusFields(
      config({
        setupComplete: true,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { enabled: true, bankId: "kai-coding", derive: "manual" },
        },
        recall: { ...DEFAULT_CONFIG.recall, maxTokens: 1200 },
      }),
      { cwd, projectBankId: "kai-coding" },
    );
    expect(fields.find((f) => f.key === "codingBank")?.tone).toBe("custom");
    expect(fields.find((f) => f.key === "recallMaxTokens")?.tone).toBe("custom");
    expect(fields.find((f) => f.key === "setup")?.tone).toBe("default");
  });

  it("warns on dead-letter queue depth", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-status-dl-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight.json"), "{}\n");
    const fields = buildStatusFields(config({ setupComplete: true }), {
      cwd,
      projectBankId: "b",
      queueLength: 1,
      deadLetterLength: 2,
    });
    expect(fields.find((f) => f.key === "queue")?.tone).toBe("warn");
  });

  it("renders text with tone markers", () => {
    const text = formatStatusFieldsText([
      { key: "a", label: "A", value: "ok", tone: "default" },
      { key: "b", label: "B", value: "custom", tone: "custom" },
      { key: "c", label: "C", value: "bad", tone: "warn" },
    ]);
    expect(text).toContain("  A: ok");
    expect(text).toContain("* B: custom");
    expect(text).toContain("! C: bad");
  });
});
