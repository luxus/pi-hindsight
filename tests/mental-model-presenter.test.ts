import { describe, expect, it } from "vitest";
import {
  mentalModelListFromUnknown,
  mentalModelOption,
  renderMentalModel,
  renderMentalModelHistory,
  renderMentalModelOperationResult,
} from "../extensions/mental-model-presenter.js";

describe("mental model presenter", () => {
  it("normalizes list responses and renders selectable labels", () => {
    const models = mentalModelListFromUnknown({
      items: [
        {
          id: "project-architecture",
          bank_id: "project-bank",
          name: "Project architecture",
          source_query: "What is the architecture?",
          tags: ["project", "architecture"],
          last_refreshed_at: "2026-05-04T01:00:00Z",
          is_stale: true,
        },
        { id: 123, name: "bad" },
      ],
    });

    expect(models).toHaveLength(1);
    expect(mentalModelOption(models[0]!)).toBe(
      "Project architecture (project-architecture) tags=project,architecture stale",
    );
    expect(renderMentalModel(models[0]!)).toContain("Source query: What is the architecture?");
  });

  it("renders history and async operation results", () => {
    expect(
      renderMentalModelHistory({
        items: [{ id: "version-1", created_at: "2026-05-04T01:00:00Z", status: "ready" }],
      }),
    ).toContain("version-1 at 2026-05-04T01:00:00Z status=ready");
    expect(renderMentalModelOperationResult({ operation_id: "op-1", status: "queued" })).toBe(
      "operation=op-1 status=queued",
    );
  });
});
