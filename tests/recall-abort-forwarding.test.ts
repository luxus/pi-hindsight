import { describe, expect, it } from "vitest";
import { recallForContext } from "../extensions/lifecycle/recall.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const messages = [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[];

describe("recallForContext abort forwarding", () => {
  it("aborts the client signal when the recall timeout fires", async () => {
    let captured: AbortSignal | undefined;
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, _query, options) => {
          captured = options?.signal;
          // Never resolves: the outer withTimeout must fire and abort the signal
          // it handed the client, so the adapted client can cancel the fetch.
          await new Promise(() => undefined);
          return { results: [] };
        },
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, timeoutMs: 25 },
      },
      scopes: [{ kind: "project", bankId: "project-bank" }],
      cwd: "/repo/project",
      messages,
    });
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toMatch(/timed out/);
    expect(captured).toBeDefined();
    expect(captured?.aborted).toBe(true);
  });
});
