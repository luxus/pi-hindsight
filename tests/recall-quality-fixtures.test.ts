import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { filterRecallQuality } from "../extensions/lifecycle/recall.js";
import { recallForContext, renderRecallBlocks } from "../extensions/lifecycle/recall.js";
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

  it("drops recall results below configured score floors and fails open for missing scores", () => {
    const result = filterRecallQuality(
      [
        { text: "Relevant project decision.", scores: { semantic: 0.72, reranker: 0.41 } },
        { text: "Low semantic candidate.", scores: { semantic: 0.2, reranker: 0.9 } },
        { text: "Low reranker candidate.", scores: { semantic: 0.9, reranker: 0.03 } },
        { text: "BM25-only candidate without scores." },
        { text: "Passthrough reranker candidate.", scores: { semantic: 0.9 } },
      ],
      { semantic: 0.65, reranker: 0.2 },
    );

    expect(result.items.map((item) => item.text)).toEqual([
      "Relevant project decision.",
      "BM25-only candidate without scores.",
      "Passthrough reranker candidate.",
    ]);
    expect(result.reasonCounts).toEqual({ "below-score-floor": 2 });
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
        {
          kind: "project",
          bankId: "project-bank",
          tagGroups: [{ tags: ["repo:abc"], match: "any_strict" }],
        },
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
