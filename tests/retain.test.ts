import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { buildRetainJob } from "../extensions/retain.js";
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
      { type: "toolCall", name: "bash", arguments: { command: "echo hi" } },
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
      { type: "toolCall", name: "bash", arguments: { command: "echo ok" } },
    ]);
    expect(job?.item.content).not.toContain("hindsight_recall");
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
