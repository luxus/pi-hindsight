import { describe, expect, it } from "vitest";
import { recallForContext } from "../extensions/lifecycle/recall.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const messages = [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[];

describe("recallForContext scope parallelism", () => {
  it("starts all scope recalls before any of them finish", async () => {
    const events: string[] = [];
    let resolveAll!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });
    const run = recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (bankId) => {
          events.push(`start:${bankId}`);
          await gate;
          events.push(`end:${bankId}`);
          return { results: [] };
        },
        reflect: async () => ({}),
      },
      config: DEFAULT_CONFIG,
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages,
    });
    // Give both recalls a chance to start (or the sequential first one to hang).
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveAll();
    const watchdog = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 2000),
    );
    const result = await Promise.race([run, watchdog]);
    // A sequential loop would deadlock on the gate: the first scope never
    // resolves, so the second never starts and recallForContext never returns.
    expect(result).not.toBe("timeout");
    expect(events.indexOf("start:project-bank")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("start:global-bank")).toBeGreaterThanOrEqual(0);
    const firstEnd = Math.min(
      events.indexOf("end:project-bank"),
      events.indexOf("end:global-bank"),
    );
    expect(events.indexOf("start:project-bank")).toBeLessThan(firstEnd);
    expect(events.indexOf("start:global-bank")).toBeLessThan(firstEnd);
    if (result !== "timeout") {
      expect(result.blocks.map((block) => block.bankId)).toEqual(["project-bank", "global-bank"]);
    }
  });

  it("keeps scope order and per-scope failure isolation under concurrency", async () => {
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (bankId) => {
          if (bankId === "global-bank") {
            await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error("boom");
          }
          return { results: [{ text: "project memory" }] };
        },
        reflect: async () => ({}),
      },
      config: DEFAULT_CONFIG,
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages,
    });
    expect(result.failed).toBe(1);
    expect(result.failures.map((failure) => failure.bankId)).toEqual(["global-bank"]);
    expect(result.blocks.map((block) => block.bankId)).toEqual(["project-bank"]);
  });
});
