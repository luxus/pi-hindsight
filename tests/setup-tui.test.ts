import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { buildConfigEditingTabs } from "../extensions/config-editing-model.js";
import { buildRetainReceiptStatusFacts, createSetupComponent } from "../extensions/setup-tui.js";

const theme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

const receipt = {
  createdAt: "2026-05-02T00:00:00.000Z",
  bankId: "global-luxus",
  documentId: "pi-explicit:session123:abcdef1234567890",
  queueJobId: "job-1",
  updateMode: "replace" as const,
  source: "tool" as const,
  context: "context",
  tags: ["preference"],
};

describe("setup TUI receipt facts", () => {
  it("shows recent exact retain document IDs without raw content", () => {
    expect(buildRetainReceiptStatusFacts([receipt])).toEqual([
      ["Recent retain", "global-luxus pi-explicit:abcdef1234567890"],
    ]);
  });

  it("shows empty receipt state", () => {
    expect(buildRetainReceiptStatusFacts([])).toEqual([["Retain receipts", "none"]]);
  });

  it("renders selected field detail text", () => {
    const tabs = buildConfigEditingTabs(
      DEFAULT_CONFIG,
      "bank",
      { project: {}, global: {}, env: {} },
      [],
      { showAdvanced: true },
    );
    const component = createSetupComponent(
      tabs,
      theme,
      { tabIndex: 2, selectedByTab: { Banks: 2 }, showAdvanced: true },
      () => undefined,
    );

    const rendered = component.render(100).join("\n");
    expect(rendered).toContain("Allows cross-project recall");
    expect(rendered).toContain("f flush");
    expect(rendered).toContain("m models read-only");
  });
});
