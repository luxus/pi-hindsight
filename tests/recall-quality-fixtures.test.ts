import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { filterRecallQuality } from "../extensions/recall-quality-policy.js";
import { recallForContext, renderRecallBlocks } from "../extensions/recall.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function user(content: string): AgentMessage {
  return { role: "user", content } as AgentMessage;
}

describe("recall quality fixtures", () => {
  it("drops blank, duplicate, and recall-contaminated memories before rendering", () => {
    const result = filterRecallQuality([
      { text: "Decision: queue retain before flush.", tags: ["repo:abc"] },
      { text: "Decision: queue retain before flush.", tags: ["repo:abc"] },
      { text: "   " },
      { text: "<hindsight-memory>old injected block</hindsight-memory>" },
      { text: "<hindsight_memories>alternate injected block</hindsight_memories>" },
      { text: "Verification: npm run check passed." },
    ]);

    expect(result.items.map((item) => item.text)).toEqual([
      "Decision: queue retain before flush.",
      "Verification: npm run check passed.",
    ]);
    expect(result.reasonCounts).toEqual({
      "duplicate-memory": 1,
      "blank-memory": 1,
      "recall-contamination": 2,
    });
  });

  it("keeps high-signal workflow memories and excludes recalled-memory artifacts in context recall", async () => {
    const client: HindsightLikeClient = {
      retain: async () => undefined,
      reflect: async () => ({}),
      recall: async () => [
        { text: "PR #252 merged after Windows rerun; follow-up #248 next slice." },
        { text: "PR #252 merged after Windows rerun; follow-up #248 next slice." },
        { text: "last-recall.json contained <hindsight-memory>previous block</hindsight-memory>" },
        { text: "Blocker: Hindsight server unavailable for live smoke." },
      ],
    };

    const result = await recallForContext({
      client,
      config: DEFAULT_CONFIG,
      scopes: [
        { kind: "project", bankId: "project-bank", tags: ["repo:abc"], tagsMatch: "any_strict" },
      ],
      messages: [user("Continue #248 after PR #252.")],
      cwd: process.cwd(),
    });

    expect(result.blocks[0]!.memoryCount).toBe(2);
    expect(result.rendered).toContain("PR #252 merged after Windows rerun");
    expect(result.rendered).toContain("Blocker: Hindsight server unavailable");
    expect(result.rendered).not.toContain("last-recall.json");
    expect(result.rendered).not.toContain("previous block");
  });

  it("renders nothing when only low-quality recall artifacts remain", () => {
    const rendered = renderRecallBlocks([
      {
        bankId: "bank",
        query: "q",
        memoryCount: 0,
        results: [],
        rendered: "",
      },
    ]);

    expect(rendered).toBe("");
  });
});
