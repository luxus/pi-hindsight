import { describe, expect, it } from "vitest";
import {
  bankConfigOverrideSummaryLines,
  bankSettingsTargetDisplay,
  bankSettingsTargetLines,
  bankTemplateSummaryLines,
  exportedBankTemplateSummaryLines,
} from "../extensions/bank-settings-presenter.js";

describe("bank settings presenter", () => {
  it("shows concrete location and bank IDs", () => {
    expect(bankSettingsTargetDisplay({ location: "Project", bankId: "project-bank" })).toEqual({
      location: "Project",
      bankId: "project-bank",
      locationLabel: "Location: Project",
      bankLabel: "Bank: project-bank",
      optionLabel: "Project bank (project-bank)",
      reviewLine: "Project → Bank: project-bank",
    });
    expect(bankSettingsTargetLines({ location: "User", bankId: "user-bank" })).toEqual([
      "Location: User",
      "Bank: user-bank",
    ]);
  });

  it("summarizes template-owned bank settings", () => {
    expect(
      bankTemplateSummaryLines({
        version: "1",
        bank: { retain_mission: "Remember project decisions", enable_observations: true },
        mental_models: [
          { id: "project-context", name: "Project Context", source_query: "What matters?" },
        ],
        directives: [{ name: "rule", content: "Prefer source facts." }],
      }),
    ).toEqual(["Bank overrides: 2", "Mental models: 1", "Directives: 1"]);
  });

  it("summarizes exported manifests and resolved config responses", () => {
    expect(
      exportedBankTemplateSummaryLines({
        bank: { retain_mission: "x" },
        mental_models: [{ id: "m" }],
        directives: [{ name: "d" }, { name: "e" }],
      }),
    ).toEqual(["Bank overrides: 1", "Mental models: 1", "Directives: 2"]);
    expect(
      bankConfigOverrideSummaryLines({
        config: { retain_mission: "resolved", reflect_mission: "resolved" },
        overrides: { retain_mission: "override" },
      }),
    ).toEqual(["Bank overrides: 1", "Resolved config fields: 2"]);
  });
});
