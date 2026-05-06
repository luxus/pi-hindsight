import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { composeRecallQuery } from "../extensions/recall.js";

describe("recall query quality", () => {
  it("uses recent workflow signal, repo hints, and bounded query context", () => {
    const messages = [
      { role: "user", content: "old task should fall out", timestamp: 1 },
      { role: "assistant", content: "PR #252 merged; follow-up #248 next slice.", timestamp: 2 },
      { role: "user", content: "Continue #248 recall quality fixture work.", timestamp: 3 },
    ] as unknown as AgentMessage[];

    const query = composeRecallQuery(messages, {
      roles: ["user", "assistant"],
      contextTurns: 2,
      maxQueryChars: 220,
      preamble: "Find relevant project memory.",
      hints: ["scope:project", "repo:abc123", "cwd:pi-hindsight"],
      includeDate: true,
      now: new Date("2026-05-06T00:00:00.000Z"),
    });

    expect(query).toContain("Find relevant project memory.");
    expect(query).toContain("Current date: 2026-05-06");
    expect(query).toContain("Context hints: scope:project; repo:abc123; cwd:pi-hindsight");
    expect(query).toContain("PR #252 merged");
    expect(query).toContain("Continue #248");
    expect(query).not.toContain("old task should fall out");
    expect(query.length).toBeLessThanOrEqual(220);
  });

  it("ignores both recall block delimiters and custom recall message metadata", () => {
    const messages = [
      {
        role: "assistant",
        content: "<hindsight-memory>old memory</hindsight-memory>",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: "<hindsight_memories>old memory</hindsight_memories>",
        timestamp: 2,
      },
      {
        role: "assistant",
        customType: "hindsight-recall",
        content: "prior recall snapshot",
        timestamp: 3,
      },
      { role: "user", content: "Need current design decision history.", timestamp: 4 },
    ] as unknown as AgentMessage[];

    const query = composeRecallQuery(messages, {
      roles: ["user", "assistant"],
      contextTurns: 4,
      maxQueryChars: 500,
    });

    expect(query).toBe("user: Need current design decision history.");
  });
});
