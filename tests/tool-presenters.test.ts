import { describe, expect, it } from "vitest";
import {
  collapseToolResultText,
  renderMemoryToolTextResult,
  retainToolResponse,
} from "../extensions/tui/tool-presenters.js";

const fakeTheme = {
  fg: (_color: string, text: string) => text,
} as never;

describe("tool presenters", () => {
  it("collapses long tool result text to a preview", () => {
    const text = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n");

    expect(collapseToolResultText(text, false)).toEqual({
      text: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
      hiddenLineCount: 3,
    });
    expect(collapseToolResultText(text, true)).toEqual({ text, hiddenLineCount: 0 });
  });

  it("renders collapsed tool results with an expansion hint", () => {
    const text = Array.from({ length: 13 }, (_, index) => `line ${index + 1}`).join("\n");
    const component = renderMemoryToolTextResult(
      { content: [{ type: "text", text }] },
      { expanded: false },
      fakeTheme,
    );

    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("line 12");
    expect(rendered).not.toContain("line 13");
    expect(rendered).toContain("... 1 more line (");
    expect(rendered).toContain("to expand");
  });

  it("renders expanded tool results with a collapse hint", () => {
    const text = Array.from({ length: 13 }, (_, index) => `line ${index + 1}`).join("\n");
    const component = renderMemoryToolTextResult(
      { content: [{ type: "text", text }] },
      { expanded: true },
      fakeTheme,
    );

    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("line 13");
    expect(rendered).toContain("to collapse");
  });

  it("summarizes immediate retain results", () => {
    const response = retainToolResponse({
      bankId: "bank",
      documentId: "doc-1",
      remaining: 0,
      deadLettered: 0,
      operationIds: ["op-1"],
    } as never);

    expect(response.content[0]?.text).toBe("Retained in bank as doc-1. Operation IDs: op-1.");
  });

  it("summarizes queued retain results with dead-letter hints", () => {
    const response = retainToolResponse({
      bankId: "bank",
      documentId: "doc-1",
      remaining: 2,
      deadLettered: 1,
    } as never);

    expect(response.content[0]?.text).toBe(
      "Queued for bank; 2 jobs pending. 1 job moved to dead-letter queue; run /hindsight to inspect.",
    );
  });
});
