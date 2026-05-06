import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
import { createRetainTurnPolicy } from "../extensions/memory-lifecycle-retain.js";
import type { RuntimeSnapshot } from "../extensions/memory-lifecycle-runtime.js";
import { importPiSession } from "../extensions/import-sessions.js";
import { recallForContext } from "../extensions/recall.js";
import { liveDocumentId, stableSessionId } from "../extensions/session.js";
import type { HindsightLikeClient, ResolvedConfig, TagsMatch } from "../extensions/types.js";
import {
  assistantMessage,
  processStatusNoise,
  progressNoise,
  recalledMemoryBlock,
  toolResult,
  userMessage,
  writePiTranscriptFixture,
} from "./helpers/memory-quality-fixtures.js";

type RetainOptions = NonNullable<Parameters<HindsightLikeClient["retain"]>[2]>;
type RecallOptions = NonNullable<Parameters<HindsightLikeClient["recall"]>[2]>;

interface RetainedMemory {
  bankId: string;
  content: string;
  options: RetainOptions;
}

interface RecallCall {
  bankId: string;
  query: string;
  options: RecallOptions;
}

function makeCwd(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function contentLine(message: Record<string, unknown>): string {
  return `${textField(message.role)}: ${textField(message.content)}`;
}

function retainedContentText(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed.map((message) => contentLine(message)).join("\n");
    const record = parsed as { messages?: Record<string, unknown>[] };
    if (Array.isArray(record.messages)) return record.messages.map(contentLine).join("\n");
  } catch {
    return content;
  }
  return content;
}

function matchTags(requested: string[], tags: string[], match: TagsMatch | undefined): boolean {
  const mode = match ?? "any_strict";
  if (mode === "all" || mode === "all_strict") return requested.every((tag) => tags.includes(tag));
  return requested.some((tag) => tags.includes(tag));
}

function tagGroupMatches(group: unknown, tags: string[]): boolean {
  const record = group as { tags?: unknown; match?: unknown };
  if (!Array.isArray(record.tags)) return false;
  return matchTags(
    record.tags.filter((tag): tag is string => typeof tag === "string"),
    tags,
    typeof record.match === "string" ? (record.match as TagsMatch) : undefined,
  );
}

function recallRequestMatches(options: RecallOptions | undefined, tags: string[]): boolean {
  if (!options) return true;
  if (Array.isArray(options.tagGroups) && options.tagGroups.length > 0) {
    return options.tagGroups.every((group) => tagGroupMatches(group, tags));
  }
  if (Array.isArray(options.tags) && options.tags.length > 0) {
    return matchTags(options.tags, tags, options.tagsMatch);
  }
  return true;
}

function createRoundtripMemoryClient() {
  const retained: RetainedMemory[] = [];
  const recallCalls: RecallCall[] = [];
  const client: HindsightLikeClient = {
    retain: async (bankId, content, options = {}) => {
      retained.push({ bankId, content, options });
    },
    recall: async (bankId, query, options = {}) => {
      recallCalls.push({ bankId, query, options });
      return retained
        .filter((memory) => memory.bankId === bankId)
        .filter((memory) => recallRequestMatches(options, memory.options.tags ?? []))
        .map((memory) => ({
          text: retainedContentText(memory.content),
          tags: memory.options.tags,
          metadata: memory.options.metadata,
        }));
    },
    reflect: async () => ({}),
  };
  return { client, retained, recallCalls };
}

function createOperations(client: HindsightLikeClient, config: ResolvedConfig = DEFAULT_CONFIG) {
  return createMemoryOperations({
    getClient: () => client,
    getConfig: () => config,
    getProjectBankId: () => "project-bank",
  });
}

function repoTag(tags: string[] | undefined): string {
  const tag = tags?.find((candidate) => candidate.startsWith("repo:"));
  expect(tag).toBeDefined();
  return tag!;
}

describe("retain/import to recall roundtrip quality", () => {
  it("roundtrips explicit global retain with advanced options, provenance, and strict global recall tags", async () => {
    const cwd = makeCwd("pi-hindsight-explicit-roundtrip-");
    const sessionFile = join(cwd, "session.jsonl");
    const store = createRoundtripMemoryClient();
    const config = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-bank" },
      },
    };
    const memory = createOperations(store.client, config);

    await memory.retainExplicit({
      cwd,
      sessionFile,
      bank: "global",
      content: "User prefers compact review handoffs with verification listed first.",
      context: "Manual user preference retain from explicit tool call.",
      tags: ["topic:preferences"],
      metadata: { source_id: "explicit-roundtrip", source: "caller-overridden" },
      documentId: "explicit-roundtrip-doc",
      updateMode: "append",
      timestamp: "2026-05-06T12:00:00.000Z",
      entities: [{ text: "review handoffs", type: "preference" }],
      observationScopes: [["source:pi", "topic:preferences"]],
      async: false,
    });

    const recalled = await memory.recall(
      cwd,
      "How should reviews be handed off?",
      "global",
      sessionFile,
      {
        tags: ["topic:preferences"],
        tagsMatch: "all_strict",
        includeChunks: true,
      },
    );

    expect(recalled.bankId).toBe("global-bank");
    expect(store.retained).toHaveLength(1);
    expect(store.retained[0]!.options).toMatchObject({
      documentId: "explicit-roundtrip-doc",
      updateMode: "append",
      context: "Manual user preference retain from explicit tool call.",
      timestamp: "2026-05-06T12:00:00.000Z",
      async: false,
      entities: [{ text: "review handoffs", type: "preference" }],
      observationScopes: [["source:pi", "topic:preferences"]],
      metadata: {
        source: "pi-hindsight",
        retainSource: "tool",
        source_id: "explicit-roundtrip",
        cwd,
        pi_session_file: sessionFile,
      },
    });
    expect(store.retained[0]!.options.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        "topic:preferences",
        `session:${stableSessionId(sessionFile, cwd)}`,
        expect.stringMatching(/^repo:/),
      ]),
    );
    expect(store.recallCalls[0]).toMatchObject({
      bankId: "global-bank",
      options: {
        includeChunks: true,
        tagGroups: [
          { tags: ["source:pi"], match: "any_strict" },
          { tags: ["topic:preferences"], match: "all_strict" },
        ],
      },
    });
    expect(store.recallCalls[0]!.options).not.toHaveProperty("tags");
    expect(recalled.result).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("compact review handoffs"),
        tags: expect.arrayContaining(["source:pi", "topic:preferences"]),
      }),
    ]);
  });

  it("roundtrips automatic retain while excluding injected recall blocks and noisy successful tools", async () => {
    const cwd = makeCwd("pi-hindsight-auto-roundtrip-");
    const sessionFile = join(cwd, "session.jsonl");
    const store = createRoundtripMemoryClient();
    const runtime: RuntimeSnapshot = {
      cwd,
      sessionFile,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    const event = {
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Keep issue #282 recall roundtrip coverage test-only.",
          timestamp: 1,
        },
        {
          id: "r1",
          role: "assistant",
          customType: "hindsight-recall",
          content: "<hindsight-memory>previous retained fact must not return</hindsight-memory>",
          timestamp: 2,
        },
        {
          id: "read1",
          role: "toolResult",
          toolName: "read",
          content: "huge successful read output should not survive automatic retain",
          isError: false,
          timestamp: 3,
        },
        {
          id: "bash1",
          role: "toolResult",
          toolName: "bash",
          content: "npm run check failed once with expected 2 got 1",
          isError: true,
          timestamp: 4,
        },
        {
          id: "a1",
          role: "assistant",
          content: "Decision: automatic retain roundtrip should recall issue #282 verification.",
          timestamp: 5,
        },
      ],
    } as unknown as AgentEndEvent;
    const policy = createRetainTurnPolicy({
      getConfig: () => DEFAULT_CONFIG,
      getClient: () => store.client,
      getProjectBankId: () => "project-bank",
      getCapabilities: () => undefined,
      setMemoryStatus: () => undefined,
      notify: () => undefined,
    });

    await policy.retain(event, runtime);
    const retained = store.retained[0]!;
    const tag = repoTag(retained.options.tags);
    const recall = await recallForContext({
      client: store.client,
      config: DEFAULT_CONFIG,
      scopes: [{ kind: "project", bankId: "project-bank", tags: [tag], tagsMatch: "any_strict" }],
      messages: [
        { role: "user", content: "What did issue #282 automatic retain decide?" } as never,
      ],
      cwd,
    });

    expect(retained.options).toMatchObject({
      documentId: liveDocumentId(sessionFile, cwd),
      updateMode: "append",
      metadata: { cwd, imported: "false", pi_session_file: sessionFile },
    });
    expect(retained.options.tags).toEqual(
      expect.arrayContaining(["source:pi", `session:${stableSessionId(sessionFile, cwd)}`, tag]),
    );
    expect(store.recallCalls[0]).toMatchObject({
      bankId: "project-bank",
      options: { tags: [tag], tagsMatch: "any_strict" },
    });
    expect(recall.rendered).toContain("Keep issue #282 recall roundtrip coverage test-only");
    expect(recall.rendered).toContain("npm run check failed once");
    expect(recall.rendered).toContain("automatic retain roundtrip should recall issue #282");
    expect(recall.rendered).not.toContain("previous retained fact");
    expect(recall.rendered).not.toContain("huge successful read output");
  });

  it("roundtrips strict curated import through project recall while excluding recall and process noise", async () => {
    const fixture = writePiTranscriptFixture(
      "roundtrip-quality",
      [
        userMessage("u1", "Fix retain queue race for issue #248."),
        toolResult("read1", "read", "huge source file output should not survive roundtrip"),
        toolResult("bash1", "bash", "npm test failed: expected 2 got 1", { isError: true }),
        assistantMessage(
          "a1",
          "Decision: keep queue-first retain behavior; PR #260 will add regression coverage.",
        ),
        recalledMemoryBlock("r1"),
      ],
      [
        processStatusNoise("proc1", "Process 'npm-check' completed successfully"),
        progressNoise(
          "last1",
          "last-recall.json contained <hindsight-memory>previous retained fact</hindsight-memory>",
        ),
      ],
    );
    const store = createRoundtripMemoryClient();
    const strictConfig = {
      ...DEFAULT_CONFIG,
      import: { ...DEFAULT_CONFIG.import, qualityProfile: "strict" as const },
    };

    const imported = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "project-bank",
      config: strictConfig,
      client: store.client,
    });
    const retained = store.retained[0]!;
    const tag = repoTag(retained.options.tags);
    const recall = await recallForContext({
      client: store.client,
      config: strictConfig,
      scopes: [{ kind: "project", bankId: "project-bank", tags: [tag], tagsMatch: "any_strict" }],
      messages: [{ role: "user", content: "What happened with issue #248?" } as never],
      cwd: fixture.dir,
    });

    expect(imported.documents[0]).toMatchObject({
      rawMessageCount: 4,
      projectedMessageCount: 3,
      droppedToolResultCount: 1,
      keptToolErrorCount: 1,
      importQualityProfile: "strict",
    });
    expect(retained.options).toMatchObject({
      updateMode: "replace",
      tags: expect.arrayContaining(["source:pi", "imported:true", "import:historical", tag]),
      metadata: expect.objectContaining({
        imported: "true",
        import_mode: "curated",
        import_quality_profile: "strict",
        tool_results: "errors-only",
      }),
    });
    expect(store.recallCalls[0]).toMatchObject({
      bankId: "project-bank",
      options: { tags: [tag], tagsMatch: "any_strict" },
    });
    expect(recall.rendered).toContain("Fix retain queue race for issue #248");
    expect(recall.rendered).toContain("npm test failed: expected 2 got 1");
    expect(recall.rendered).toContain("Decision: keep queue-first retain behavior");
    expect(recall.rendered).toContain("PR #260");
    expect(recall.rendered).not.toContain("huge source file output");
    expect(recall.rendered).not.toContain("previous retained fact");
    expect(recall.rendered).not.toContain("hindsight-recall");
    expect(recall.rendered).not.toContain("last-recall.json");
    expect(recall.rendered).not.toContain("Process 'npm-check' completed successfully");
  });
});
