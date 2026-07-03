import { describe, expect, it } from "vitest";
import {
  composeRecallQuery,
  recallForContext,
  renderRecallBlocks,
} from "../extensions/lifecycle/recall.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("recall formatting", () => {
  it("builds query from recent user messages", () => {
    const messages = [
      { role: "user", content: "first", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        timestamp: 2,
        api: "x",
        provider: "x",
        model: "m",
        usage: {},
        stopReason: "stop",
      },
      { role: "user", content: "second", timestamp: 3 },
    ] as unknown as AgentMessage[];
    expect(
      composeRecallQuery(messages, { roles: ["user"], contextTurns: 1, maxQueryChars: 800 }),
    ).toBe("user: second");
  });

  it("respects roles, context turns, max query chars, and ignores injected memory", () => {
    const messages = [
      { role: "user", content: "first user", timestamp: 1 },
      { role: "assistant", content: "first assistant", timestamp: 2 },
      { role: "user", content: "<hindsight-memory>old</hindsight-memory>", timestamp: 3 },
      { role: "assistant", content: "second assistant with long suffix", timestamp: 4 },
    ] as unknown as AgentMessage[];

    expect(
      composeRecallQuery(messages, {
        roles: ["assistant"],
        contextTurns: 1,
        maxQueryChars: 12,
      }),
    ).toBe("long suffix");
  });

  it("keeps legitimate user mentions of the hindsight-memory token", () => {
    const messages = [
      { role: "user", content: "Please explain literal <hindsight-memory> tags", timestamp: 1 },
    ] as unknown as AgentMessage[];

    expect(
      composeRecallQuery(messages, {
        roles: ["user"],
        contextTurns: 1,
        maxQueryChars: 200,
      }),
    ).toBe("user: Please explain literal <hindsight-memory> tags");
  });

  it("adds deterministic preamble and optional date", () => {
    const messages = [
      { role: "user", content: "ship it", timestamp: 1 },
    ] as unknown as AgentMessage[];

    expect(
      composeRecallQuery(messages, {
        roles: ["user"],
        contextTurns: 1,
        maxQueryChars: 200,
        preamble: "Find relevant project memory.",
        includeDate: true,
        now: new Date("2026-04-27T12:00:00.000Z"),
      }),
    ).toBe("Find relevant project memory.\n\nCurrent date: 2026-04-27\n\nuser: ship it");
  });

  it("falls back when selected turns have no text", () => {
    const messages = [
      { role: "assistant", content: [], timestamp: 1 },
    ] as unknown as AgentMessage[];

    expect(
      composeRecallQuery(messages, {
        roles: ["assistant"],
        contextTurns: 1,
        maxQueryChars: 200,
      }),
    ).toBe("current Pi coding task");
  });

  it("keeps recall queries text-oriented for rich content", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", mimeType: "image/png", data: "base64-secret" },
          { type: "custom", payload: { nested: true } },
        ],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "running command" },
          { type: "toolCall", name: "bash", arguments: { command: "echo hi" } },
        ],
        timestamp: 2,
      },
    ] as unknown as AgentMessage[];

    const query = composeRecallQuery(messages, {
      roles: ["user", "assistant"],
      contextTurns: 2,
      maxQueryChars: 500,
    });

    expect(query).toContain("user: look at this");
    expect(query).toContain("[image omitted]");
    expect(query).toContain("assistant: running command");
    expect(query).toContain("[toolCall bash]");
    expect(query).not.toContain("base64-secret");
    expect(query).not.toContain('"type"');
  });

  it("adds deterministic context hints", () => {
    const messages = [
      { role: "user", content: "ship it", timestamp: 1 },
    ] as unknown as AgentMessage[];

    expect(
      composeRecallQuery(messages, {
        roles: ["user"],
        contextTurns: 1,
        maxQueryChars: 300,
        preamble: "Find memory.",
        hints: ["scope:project", "repo:abc", "cwd:repo"],
      }),
    ).toBe("Find memory.\n\nContext hints: scope:project; repo:abc; cwd:repo\n\nuser: ship it");
  });

  it("keeps preamble and hints when truncating long message text", () => {
    const messages = [
      { role: "user", content: `prefix ${"x".repeat(200)} suffix`, timestamp: 1 },
    ] as unknown as AgentMessage[];

    const query = composeRecallQuery(messages, {
      roles: ["user"],
      contextTurns: 1,
      maxQueryChars: 120,
      preamble: "Find memory.",
      hints: ["scope:project"],
    });

    expect(query).toContain("Find memory.");
    expect(query).toContain("scope:project");
    expect(query).toContain("suffix");
  });

  it("keeps preamble and hints when earlier selected turn is long", () => {
    const messages = [
      { role: "assistant", content: `long ${"x".repeat(300)}`, timestamp: 1 },
      { role: "user", content: "current question", timestamp: 2 },
    ] as unknown as AgentMessage[];

    const query = composeRecallQuery(messages, {
      roles: ["user", "assistant"],
      contextTurns: 2,
      maxQueryChars: 130,
      preamble: "Find memory.",
      hints: ["scope:project"],
    });

    expect(query).toContain("Find memory.");
    expect(query).toContain("scope:project");
    expect(query).toContain("current question");
  });

  it("keeps scope hints when repo hints are disabled", async () => {
    const queries: string[] = [];
    await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, query) => {
          queries.push(query);
          return { results: [] };
        },
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, includeRepoHintsInQuery: false },
      },
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(queries[0]).toContain("scope:project");
    expect(queries[0]).not.toContain("repo:");
    expect(queries[0]).not.toContain("cwd:");
    expect(queries[1]).toContain("scope:global");
  });

  it("keeps successful bank recall when another bank fails", async () => {
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (bankId) => {
          if (bankId === "project-bank") throw new Error("timeout");
          return { results: [{ text: "global memory" }] };
        },
        reflect: async () => ({}),
      },
      config: DEFAULT_CONFIG,
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(result.failed).toBe(1);
    expect(result.rendered).toContain("global memory");
    expect(result.blocks.map((block) => block.bankId)).toEqual(["global-bank"]);
  });

  it("uses bank-aware preambles and query hints", async () => {
    const queries: string[] = [];
    await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, query) => {
          queries.push(query);
          return { results: [] };
        },
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: {
          ...DEFAULT_CONFIG.recall,
          projectQueryPreamble: "Project lookup.",
          globalQueryPreamble: "Global lookup.",
        },
      },
      scopes: [
        { kind: "project", bankId: "project-bank" },
        { kind: "global", bankId: "global-bank" },
      ],
      cwd: "/repo/project",
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(queries[0]).toContain("Project lookup.");
    expect(queries[0]).toContain("scope:project");
    expect(queries[1]).toContain("Global lookup.");
    expect(queries[1]).toContain("scope:global");
    expect(queries[1]).not.toContain("repo:");
    expect(queries[1]).not.toContain("cwd:");
  });

  it("renders memory block", () => {
    const rendered = renderRecallBlocks([
      {
        bankId: "b",
        query: "q",
        memoryCount: 1,
        rendered: "",
        results: [{ text: "Remember X", tags: ["source:pi"] }],
      },
    ]);
    expect(rendered).toContain("<hindsight-memory>");
    expect(rendered).toContain("Remember X");
  });

  it("limits rendered memories with topK", () => {
    const rendered = renderRecallBlocks(
      [
        {
          bankId: "b",
          query: "q",
          memoryCount: 2,
          rendered: "",
          results: [{ text: "one" }, { text: "two" }],
        },
      ],
      1,
    );
    expect(rendered).toContain("one");
    expect(rendered).not.toContain("two");
  });

  it("renders source-fact evidence lines under observations, capped per item", () => {
    const rendered = renderRecallBlocks([
      {
        bankId: "b",
        query: "q",
        memoryCount: 1,
        rendered: "",
        results: [
          {
            text: "User prefers tabs",
            tags: ["source:pi"],
            sourceFacts: [
              "said use tabs in #12",
              "reverted spaces PR",
              "config sets tabs",
              "extra",
            ],
          },
        ],
      },
    ]);
    expect(rendered).toContain("1. User prefers tabs");
    expect(rendered).toContain("   - evidence: said use tabs in #12");
    expect(rendered).toContain("   - evidence: reverted spaces PR");
    expect(rendered).toContain("   - evidence: config sets tabs");
    expect(rendered).not.toContain("extra");
  });

  it("requests source facts and renders resolved evidence when enabled", async () => {
    const options: Record<string, unknown>[] = [];
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, _query, opts) => {
          options.push((opts ?? {}) as Record<string, unknown>);
          return {
            results: [{ text: "observation A", source_fact_ids: ["f1", "f2"] }],
            source_facts: { f1: { text: "evidence one" }, f2: { text: "evidence two" } },
          };
        },
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, includeSourceFacts: true, maxSourceFactsTokens: 256 },
      },
      scopes: [{ bankId: "b" }],
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(options[0]).toMatchObject({ includeSourceFacts: true, maxSourceFactsTokens: 256 });
    expect(result.rendered).toContain("observation A");
    expect(result.rendered).toContain("   - evidence: evidence one");
    expect(result.rendered).toContain("   - evidence: evidence two");
  });

  it("does not request source facts by default", async () => {
    const options: Record<string, unknown>[] = [];
    await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, _query, opts) => {
          options.push((opts ?? {}) as Record<string, unknown>);
          return { results: [{ text: "x" }] };
        },
        reflect: async () => ({}),
      },
      config: DEFAULT_CONFIG,
      scopes: [{ bankId: "b" }],
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(options[0]).not.toHaveProperty("includeSourceFacts");
    expect(options[0]).not.toHaveProperty("maxSourceFactsTokens");
  });

  it("passes preferObservations from config to the recall call", async () => {
    const options: Record<string, unknown>[] = [];
    await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, _query, opts) => {
          options.push((opts ?? {}) as Record<string, unknown>);
          return { results: [{ text: "x" }] };
        },
        reflect: async () => ({}),
      },
      config: { ...DEFAULT_CONFIG, recall: { ...DEFAULT_CONFIG.recall, preferObservations: true } },
      scopes: [{ bankId: "b" }],
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(options[0]).toMatchObject({ preferObservations: true });
  });

  it("bounds User Bank recall with userMaxTokens, independent of the Project Bank budget", async () => {
    const options: Record<string, unknown>[] = [];
    await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async (_bankId, _query, opts) => {
          options.push((opts ?? {}) as Record<string, unknown>);
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
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(options[0]).toMatchObject({ maxTokens: DEFAULT_CONFIG.recall.maxTokens });
    expect(options[1]).toMatchObject({ maxTokens: DEFAULT_CONFIG.recall.userMaxTokens });
    expect(DEFAULT_CONFIG.recall.userMaxTokens).toBeLessThan(DEFAULT_CONFIG.recall.maxTokens);
  });

  it("records slow recall as failed without throwing", async () => {
    const result = await recallForContext({
      client: {
        retain: async () => undefined,
        recall: async () => new Promise(() => undefined),
        reflect: async () => ({}),
      },
      config: {
        ...DEFAULT_CONFIG,
        recall: { ...DEFAULT_CONFIG.recall, timeoutMs: 5 },
      },
      scopes: [{ bankId: "b" }],
      messages: [{ role: "user", content: "q", timestamp: 1 }] as unknown as AgentMessage[],
    });

    expect(result).toMatchObject({ rendered: "", blocks: [], failed: 1 });
  });
});
