import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  buildRetainJob,
  enqueueRetainFromAgentEnd,
  recordRetainDeliveries,
} from "../extensions/lifecycle/retain.js";
import { listRetainReceipts } from "../extensions/lifecycle/retain-receipts.js";
import { readQueuedRetains } from "../extensions/queue/queue.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";
import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";

describe("buildRetainJob", () => {
  it("stores structured JSON with append mode and context", () => {
    const timestamp = Date.UTC(2024, 0, 2, 3, 4, 5);
    const messages = [
      { role: "user", content: "API_KEY=secret", timestamp },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({
      config: DEFAULT_CONFIG,
      cwd: "/repo",
      sessionFile: "/tmp/s.jsonl",
      bankId: "bank",
      messages,
    });
    expect(job?.updateMode).toBe("append");
    expect(job?.documentId).toMatch(/^pi-session:/);
    expect(job?.item.context).toContain("Pi coding session");
    expect(job?.item.async).toBe(true);
    expect(job?.item.strategy).toBe("conversation");
    expect(job?.item.content).not.toContain("API_KEY=secret");
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<Record<string, unknown>>;
    expect(retained[0]?.role).toBe("user");
    expect(retained[0]?.timestamp).toBe("2024-01-02T03:04:05.000Z");
  });

  it("adds configured entities to automatic retain jobs", () => {
    const messages = [
      { role: "user", content: "remember Pi", timestamp: Date.now() },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({
      config: {
        ...DEFAULT_CONFIG,
        retain: { ...DEFAULT_CONFIG.retain, entities: [{ text: "Pi", type: "project" }] },
      },
      cwd: "/repo",
      bankId: "bank",
      messages,
    });

    expect(job?.item.entities).toEqual([{ text: "Pi", type: "project" }]);
  });

  it("expands observation scopes into retain jobs", () => {
    const messages = [
      { role: "user", content: "remember", timestamp: Date.now() },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({
      config: {
        ...DEFAULT_CONFIG,
        observations: { enabled: true, scopes: [["repo:{repoKey}"], ["bank:{projectBankId}"]] },
      },
      cwd: "/repo",
      sessionFile: "/tmp/s.jsonl",
      bankId: "bank",
      messages,
    });

    expect(job?.item.observationScopes).toEqual([[expect.stringMatching(/^repo:/)], ["bank:bank"]]);
  });

  it("excludes noisy and recursive tool results by default but keeps errors", () => {
    const messages = [
      { role: "assistant", content: "Running tools", timestamp: Date.now() },
      {
        role: "toolResult",
        toolName: "read",
        isError: false,
        content: "huge file",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolName: "hindsight_recall",
        isError: false,
        content: "memory",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolName: "bash",
        isError: true,
        content: "failed",
        timestamp: Date.now(),
      },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({ config: DEFAULT_CONFIG, cwd: "/repo", bankId: "bank", messages });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<Record<string, unknown>>;

    expect(retained.map((message) => message.content).join("\n")).toContain("failed");
    expect(retained.map((message) => message.content).join("\n")).not.toContain("huge file");
    expect(retained.map((message) => message.content).join("\n")).not.toContain("memory");
  });

  it("honors assistant text, toolCall, and thinking selectors", () => {
    const baseMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "assistant text" },
        { type: "thinking", thinking: "private thought" },
        { type: "toolCall", name: "bash", arguments: { command: "echo hi" } },
      ],
      timestamp: Date.now(),
    } as unknown as AgentEndEvent["messages"][number];

    const toolOnly = buildRetainJob({
      config: {
        ...DEFAULT_CONFIG,
        retain: {
          ...DEFAULT_CONFIG.retain,
          content: { ...DEFAULT_CONFIG.retain.content, assistant: ["toolCall"] },
        },
      },
      cwd: "/repo",
      bankId: "bank",
      messages: [baseMessage] as AgentEndEvent["messages"],
    });
    const toolOnlyRetained = JSON.parse(toolOnly?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(toolOnlyRetained[0]?.content).toEqual([
      { type: "toolCall", name: "bash", arguments: { target: "echo hi" } },
    ]);
    expect(toolOnly?.item.content).not.toContain("assistant text");

    const thinkingOnly = buildRetainJob({
      config: {
        ...DEFAULT_CONFIG,
        retain: {
          ...DEFAULT_CONFIG.retain,
          content: { ...DEFAULT_CONFIG.retain.content, assistant: ["thinking"] },
        },
      },
      cwd: "/repo",
      bankId: "bank",
      messages: [baseMessage] as AgentEndEvent["messages"],
    });
    const thinkingOnlyRetained = JSON.parse(thinkingOnly?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(thinkingOnlyRetained[0]?.content).toEqual([
      { type: "thinking", thinking: "private thought" },
    ]);
    expect(thinkingOnly?.item.content).not.toContain("assistant text");
    expect(thinkingOnly?.item.content).not.toContain("toolCall");
  });

  it("filters excluded assistant tool calls without dropping assistant text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "keep this" },
          { type: "toolCall", name: "hindsight_recall", arguments: { query: "x" } },
          { type: "toolCall", name: "bash", arguments: { command: "echo ok" } },
        ],
        timestamp: Date.now(),
      },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({ config: DEFAULT_CONFIG, cwd: "/repo", bankId: "bank", messages });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(retained[0]?.content).toEqual([
      { type: "text", text: "keep this" },
      { type: "toolCall", name: "bash", arguments: { target: "echo ok" } },
    ]);
    expect(job?.item.content).not.toContain("hindsight_recall");
  });

  it("compacts tool-call arguments to primary target by default", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "edit",
            arguments: { file_path: "src/a.ts", old_string: "x", new_string: "y".repeat(50) },
          },
        ],
        timestamp: Date.now(),
      },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({ config: DEFAULT_CONFIG, cwd: "/repo", bankId: "bank", messages });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(retained[0]?.content).toEqual([
      { type: "toolCall", name: "edit", arguments: { target: "src/a.ts" } },
    ]);
    expect(job?.item.content).not.toContain("old_string");
    expect(job?.item.content).not.toContain("new_string");
  });

  it("keeps full tool-call arguments when compactToolCalls is false", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", name: "bash", arguments: { command: "echo hi" } }],
        timestamp: Date.now(),
      },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({
      config: {
        ...DEFAULT_CONFIG,
        retain: { ...DEFAULT_CONFIG.retain, compactToolCalls: false },
      },
      cwd: "/repo",
      bankId: "bank",
      messages,
    });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(retained[0]?.content).toEqual([
      { type: "toolCall", name: "bash", arguments: { command: "echo hi" } },
    ]);
  });

  it("preserves rich user content instead of flattening to text", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "see image" },
          { type: "image", mimeType: "image/png", url: "file:///tmp/screenshot.png" },
          { type: "custom", payload: { nested: true } },
        ],
        timestamp: Date.now(),
      },
    ] as unknown as AgentEndEvent["messages"];

    const job = buildRetainJob({ config: DEFAULT_CONFIG, cwd: "/repo", bankId: "bank", messages });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<{
      content: Array<Record<string, unknown>>;
    }>;

    expect(retained[0]?.content).toEqual([
      { type: "text", text: "see image" },
      { type: "image", mimeType: "image/png", url: "file:///tmp/screenshot.png" },
      { type: "custom", payload: { nested: true } },
    ]);
  });

  it("strips configured fields", () => {
    const config = {
      ...DEFAULT_CONFIG,
      retain: { ...DEFAULT_CONFIG.retain, strip: { message: ["model"], topLevel: ["content"] } },
    };
    const messages = [
      { role: "assistant", model: "m", content: "answer", timestamp: Date.now() },
    ] as unknown as AgentEndEvent["messages"];
    const job = buildRetainJob({ config, cwd: "/repo", bankId: "bank", messages });
    const retained = JSON.parse(job?.item.content ?? "[]") as Array<Record<string, unknown>>;
    expect(retained[0]).not.toHaveProperty("model");
    expect(retained[0]).not.toHaveProperty("content");
  });
});

describe("recordRetainDeliveries", () => {
  it("persists queue-source receipts with outcome aggregates", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-deliveries-"));
    await recordRetainDeliveries(cwd, DEFAULT_CONFIG, {
      sent: 1,
      remaining: 0,
      deadLettered: 0,
      malformed: 0,
      delivered: [
        {
          queueJobId: "job-1",
          bankId: "bank",
          documentId: "pi-session:abc",
          updateMode: "append",
          context: "Pi coding session",
          tags: ["source:pi"],
          outcome: { itemsCount: 3, operations: 1 },
        },
      ],
    });

    const receipts = await listRetainReceipts(cwd, 10);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      source: "queue",
      documentId: "pi-session:abc",
      outcome: { itemsCount: 3, operations: 1 },
    });
  });

  it("writes no receipts when there are no deliveries", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-deliveries-"));
    await recordRetainDeliveries(cwd, DEFAULT_CONFIG, {
      sent: 0,
      remaining: 0,
      deadLettered: 0,
      malformed: 0,
    });
    expect(await listRetainReceipts(cwd, 10)).toEqual([]);
  });
});

describe("enqueueRetainFromAgentEnd delivery modes", () => {
  const messages = [
    { role: "user", content: "remember this", timestamp: Date.now() },
  ] as unknown as AgentEndEvent["messages"];

  function trackingClient(): { client: HindsightLikeClient; retainCalls: number } {
    const state = { retainCalls: 0 };
    const client: HindsightLikeClient = {
      retain: async () => {
        state.retainCalls += 1;
        return { status: "ok" };
      },
      recall: async () => [],
      reflect: async () => ({}),
    };
    return {
      client,
      get retainCalls() {
        return state.retainCalls;
      },
    };
  }

  it("immediate delivery flushes to the client on every agent_end", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-delivery-"));
    const tracked = trackingClient();
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      retain: { ...DEFAULT_CONFIG.retain, delivery: "immediate" },
    };
    const result = await enqueueRetainFromAgentEnd({
      event: { messages } as AgentEndEvent,
      cwd,
      config,
      client: tracked.client,
      bankId: "bank",
    });
    expect(result.queued).toBe(true);
    expect(result.sent).toBe(1);
    expect(tracked.retainCalls).toBe(1);
    expect(await readQueuedRetains(cwd, config)).toHaveLength(0);
  });

  it("blocks automatic retain before queue admission when retain.beforeEnqueue fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-delivery-"));
    const checker = join(cwd, "checker.mjs");
    writeFileSync(checker, "process.exit(1);\n");
    const tracked = trackingClient();
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      retain: {
        ...DEFAULT_CONFIG.retain,
        beforeEnqueue: { command: [process.execPath, checker], timeoutMs: 2_000 },
      },
    };

    await expect(
      enqueueRetainFromAgentEnd({
        event: { messages } as AgentEndEvent,
        cwd,
        config,
        client: tracked.client,
        bankId: "bank",
      }),
    ).rejects.toThrow("retain.beforeEnqueue blocked retain job before queue admission");
    expect(tracked.retainCalls).toBe(0);
    expect(existsSync(join(cwd, DEFAULT_CONFIG.retain.queuePath))).toBe(false);
  });

  it("coalesced delivery enqueues without contacting the client and merges runs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-delivery-"));
    const tracked = trackingClient();
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      retain: { ...DEFAULT_CONFIG.retain, delivery: "coalesced" },
    };
    const args = {
      event: { messages } as AgentEndEvent,
      cwd,
      config,
      client: tracked.client,
      bankId: "bank",
    };
    const first = await enqueueRetainFromAgentEnd(args);
    const second = await enqueueRetainFromAgentEnd(args);
    expect(tracked.retainCalls).toBe(0);
    expect(first.queued).toBe(true);
    expect(first.sent).toBe(0);
    // Two agent_end runs collapse into a single pending queue entry.
    expect(second.remaining).toBe(1);
    expect(await readQueuedRetains(cwd, config)).toHaveLength(1);
  });
});
