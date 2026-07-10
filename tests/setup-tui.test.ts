import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { buildConfigEditingTabs } from "../extensions/config/config-editing-model.js";
import {
  buildRetainReceiptStatusFacts,
  createSetupComponent,
} from "../extensions/tui/setup-tui.js";
import { HUB_ACTION_HELP } from "../extensions/tui/setup-tui-types.js";

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
    // Banks field order: memoryProfile, agentUse, mentalModelsInject, projectBankId, globalBankEnabled, ...
    const component = createSetupComponent(
      tabs,
      theme,
      { tabIndex: 2, selectedByTab: { Banks: 4 }, showAdvanced: true },
      () => undefined,
    );

    const rendered = component.render(100).join("\n");
    expect(rendered).toContain("Docs: https://luxus.github.io/pi-hindsight/concepts/memory-banks/");
    expect(rendered).toContain("Allows cross-project recall");
    // Footer is width-truncated; assert the full hub help string and visible prefix.
    expect(HUB_ACTION_HELP).toContain("f flush");
    expect(HUB_ACTION_HELP).toContain("t templates");
    expect(HUB_ACTION_HELP).toContain("a advanced");
    expect(HUB_ACTION_HELP.indexOf("f flush")).toBeLessThan(HUB_ACTION_HELP.indexOf("t templates"));
    expect(rendered).toContain("g guided");
    expect(rendered).toContain("m mode");
    expect(rendered).toContain("x next-opt-out");
  });

  it("default hub shows Status only until advanced is enabled", () => {
    const basic = buildConfigEditingTabs(DEFAULT_CONFIG, "bank", {
      project: {},
      global: {},
      env: {},
    });
    expect(basic.map((tab) => tab.id)).toEqual(["Status"]);
    const advanced = buildConfigEditingTabs(
      DEFAULT_CONFIG,
      "bank",
      { project: {}, global: {}, env: {} },
      [],
      { showAdvanced: true },
    );
    expect(advanced.map((tab) => tab.id)).toContain("Banks");
  });
});
