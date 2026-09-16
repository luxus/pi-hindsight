import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { recallForContext } from "../extensions/lifecycle/recall.js";
import { createHindsightClient } from "../extensions/client/client.js";
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

  it("does not abort a sibling scope when one recall times out", async () => {
    const siblingSignals: boolean[] = [];
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (bankId, _query, options) => {
          if (bankId === "project-bank") {
            await new Promise(() => undefined);
            return { results: [] };
          }
          siblingSignals.push(Boolean(options?.signal?.aborted));
          await new Promise((resolve) => setTimeout(resolve, 20));
          siblingSignals.push(Boolean(options?.signal?.aborted));
          return { results: [{ text: "user memory" }] };
        },
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, timeoutMs: 25 },
      },
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages,
    });
    expect(result.failed).toBe(1);
    expect(result.failures.map((failure) => failure.bankId)).toEqual(["project-bank"]);
    expect(result.blocks.map((block) => block.bankId)).toEqual(["global-bank"]);
    expect(result.rendered).toContain("user memory");
    expect(siblingSignals).toEqual([false, false]);
  });

  it("aborts the underlying HTTP request end-to-end when the recall timeout fires", async () => {
    // Composed path: recallForContext -> adapted client -> real fetch -> local
    // server. Mental-model inject is off so the only HTTP call is recall.
    // Client timeout stays far above recall timeout: if the outer signal is not
    // forwarded, the socket stays open until the 5s client timeout and this
    // test fails the close wait. With forwarding, disconnect happens at ~40ms.
    let closed = false;
    let resolveClose!: () => void;
    const closedAt = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const server = createServer((req, _res) => {
      req.on("close", () => {
        closed = true;
        resolveClose();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const client = createHindsightClient({
      ...DEFAULT_CONFIG,
      hindsight: {
        ...DEFAULT_CONFIG.hindsight,
        baseUrl: `http://127.0.0.1:${address.port}`,
        timeoutMs: 5_000,
      },
    });
    try {
      const result = await recallForContext({
        client,
        config: {
          ...DEFAULT_CONFIG,
          mentalModels: { ...DEFAULT_CONFIG.mentalModels, inject: false },
          recall: { ...DEFAULT_CONFIG.recall, timeoutMs: 40 },
        },
        scopes: [{ kind: "project", bankId: "project-bank" }],
        cwd: "/repo/project",
        messages,
      });
      expect(result.failed).toBe(1);
      expect(result.failures[0]?.error).toMatch(/timed out/);
      const outcome = await Promise.race([
        closedAt.then(() => "closed" as const),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 250)),
      ]);
      expect(outcome).toBe("closed");
      expect(closed).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
