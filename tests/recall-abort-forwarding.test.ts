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

  it("aborts the underlying HTTP request end-to-end when the recall timeout fires", async () => {
    // Composed path: recallForContext -> adapted client -> real fetch -> local
    // server. The server never responds; when the recall timeout fires the
    // connection must be aborted server-side, which is exactly what lets a
    // Hindsight server cancel the recall instead of running it to completion.
    let aborted = false;
    const server = createServer((req, _res) => {
      req.on("close", () => {
        aborted = true;
      });
      // Intentionally never respond before the timeout.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const client = createHindsightClient({
      ...DEFAULT_CONFIG,
      hindsight: {
        ...DEFAULT_CONFIG.hindsight,
        baseUrl: `http://127.0.0.1:${address.port}`,
        // Both timeouts stay short for the test: the client-level timeout is
        // above the recall timeout so the outer recall timeout fires first,
        // and low enough that the post-recall mental-model load against the
        // unresponsive server fails fast instead of hanging the test.
        timeoutMs: 200,
      },
    });
    try {
      const result = await recallForContext({
        client,
        config: {
          ...DEFAULT_CONFIG,
          recall: { ...DEFAULT_CONFIG.recall, timeoutMs: 40 },
        },
        scopes: [{ kind: "project", bankId: "project-bank" }],
        cwd: "/repo/project",
        messages,
      });
      expect(result.failed).toBe(1);
      expect(result.failures[0]?.error).toMatch(/timed out/);
      // Give the socket close a moment to propagate to the server handler.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(aborted).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
