import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { abortError, isAbortError, throwIfAborted } from "../extensions/client/timeout.js";
import { createHindsightClient } from "../extensions/client/client.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";

describe("abort helpers", () => {
  it("detects AbortError names and aborted messages, not timeouts", () => {
    const named = new Error("stopped");
    named.name = "AbortError";
    expect(isAbortError(named)).toBe(true);
    expect(isAbortError(abortError("hindsight recall"))).toBe(true);
    expect(isAbortError(new Error("hindsight recall aborted"))).toBe(true);
    expect(isAbortError(new Error("hindsight recall timed out after 20ms"))).toBe(false);
    expect(isAbortError(new Error("server unavailable"))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it("throwIfAborted throws only when the signal is aborted", () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(undefined, "hindsight recall")).not.toThrow();
    expect(() => throwIfAborted(controller.signal, "hindsight recall")).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, "hindsight recall")).toThrow(/aborted/);
  });
});

describe("Hindsight client timeout", () => {
  it("rejects slow calls using configured timeout", async () => {
    const server = createServer((_req, _res) => {
      // Intentionally never respond before timeout.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const client = createHindsightClient({
      ...DEFAULT_CONFIG,
      hindsight: {
        ...DEFAULT_CONFIG.hindsight,
        baseUrl: `http://127.0.0.1:${address.port}`,
        timeoutMs: 20,
      },
    });
    try {
      await expect(client.recall("bank", "q", { budget: "low" })).rejects.toThrow("timed out");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects when caller aborts an in-flight call", async () => {
    const server = createServer((_req, _res) => {
      // Intentionally never respond before caller abort.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const client = createHindsightClient({
      ...DEFAULT_CONFIG,
      hindsight: {
        ...DEFAULT_CONFIG.hindsight,
        baseUrl: `http://127.0.0.1:${address.port}`,
        timeoutMs: 10_000,
      },
    });
    const controller = new AbortController();
    try {
      const pending = expect(
        client.recall("bank", "q", { budget: "low", signal: controller.signal }),
      ).rejects.toThrow("aborted");
      controller.abort();
      await pending;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
