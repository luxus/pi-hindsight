import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { importPiSession } from "../extensions/import-sessions.js";
import {
  assistantMessage,
  captureRetainClient,
  parsedRetainedMessages,
  processStatusNoise,
  progressNoise,
  recalledMemoryBlock,
  toolResult,
  userMessage,
  writePiTranscriptFixture,
} from "./helpers/memory-quality-fixtures.js";

describe("memory quality import fixtures", () => {
  it("keeps normal coding-session signal while dropping noisy successful tool output", async () => {
    const fixture = writePiTranscriptFixture("quality-normal-coding", [
      userMessage("u1", "Fix queue replay bug and keep issue #248 updated."),
      toolResult("read1", "read", "large file output that should not become durable memory"),
      toolResult("bash1", "bash", "npm test failed: expected queue length 1, received 0", {
        isError: true,
      }),
      assistantMessage("a1", "Decision: preserve queue-first retain and add regression coverage."),
    ]);
    const client = captureRetainClient();

    const result = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client,
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 4,
      projectedMessageCount: 3,
      droppedToolResultCount: 1,
      keptToolErrorCount: 1,
      classificationReasonCounts: {
        "user-text": 1,
        "tool-filter-excluded": 1,
        "tool-error-kept": 1,
        "assistant-text": 1,
      },
    });
    const retainedMessages = parsedRetainedMessages(client.retained[0]!.content);
    expect(retainedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("#248") }),
        expect.objectContaining({
          role: "toolResult",
          toolName: "bash",
          isError: true,
          content: expect.stringContaining("npm test failed"),
        }),
        expect.objectContaining({
          role: "assistant",
          content: expect.stringContaining("Decision: preserve queue-first retain"),
        }),
      ]),
    );
    expect(retainedMessages[0]).toMatchObject({ id: "u1", parentId: null });
    expect(retainedMessages[1]).toMatchObject({ id: "bash1", parentId: "read1" });
    expect(JSON.stringify(retainedMessages)).not.toContain("large file output");
  });

  it("can keep bounded summaries for successful tool output when configured", async () => {
    const fixture = writePiTranscriptFixture("quality-tool-summary", [
      userMessage("u1", "Need exact command summary."),
      toolResult("bash1", "bash", "line1\nline2\nline3\nline4"),
      assistantMessage("a1", "Use summarized successful output as context."),
    ]);
    const client = captureRetainClient();

    const result = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "bank",
      config: {
        ...DEFAULT_CONFIG,
        import: { ...DEFAULT_CONFIG.import, toolResults: "summary", toolResultSummaryMaxChars: 11 },
      },
      client,
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 3,
      projectedMessageCount: 3,
      droppedToolResultCount: 0,
      classificationReasonCounts: {
        "user-text": 1,
        "message-kept": 1,
        "assistant-text": 1,
      },
    });
    const retained = parsedRetainedMessages(client.retained[0]!.content);
    expect(retained[1]).toMatchObject({
      id: "bash1",
      role: "toolResult",
      toolName: "bash",
      content: "line1\nline2…",
    });
  });

  it("still respects tool filters when successful tool summaries are enabled", async () => {
    const fixture = writePiTranscriptFixture("quality-tool-summary-filter", [
      userMessage("u1", "Read file then summarize decision."),
      toolResult("read1", "read", "excluded read output must not be imported"),
      toolResult("bash1", "bash", "included command output"),
      assistantMessage("a1", "Decision after reading file."),
    ]);
    const client = captureRetainClient();

    const result = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "bank",
      config: { ...DEFAULT_CONFIG, import: { ...DEFAULT_CONFIG.import, toolResults: "summary" } },
      client,
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 4,
      projectedMessageCount: 3,
      droppedToolResultCount: 1,
      topDroppedTools: [{ name: "read", count: 1, bytes: expect.any(Number) }],
      classificationReasonCounts: {
        "user-text": 1,
        "tool-filter-excluded": 1,
        "message-kept": 1,
        "assistant-text": 1,
      },
    });
    const retained = JSON.stringify(parsedRetainedMessages(client.retained[0]!.content));
    expect(retained).toContain("included command output");
    expect(retained).not.toContain("excluded read output");
  });

  it("ignores UI/process chatter and repeated successful tool output in curated import", async () => {
    const fixture = writePiTranscriptFixture(
      "quality-process-noise",
      [
        userMessage("u1", "Continue review loop."),
        toolResult("proc1", "process", "Refreshing checks status every 30 seconds"),
        toolResult("proc2", "process", "Refreshing checks status every 30 seconds"),
        toolResult("proc3", "process", "Refreshing checks status every 30 seconds"),
        assistantMessage("a1", "Checks still pending; watcher continues."),
      ],
      [processStatusNoise("p1", "watcher pending"), progressNoise("p2", "spinner: waiting for CI")],
    );

    const result = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 5,
      projectedMessageCount: 2,
      droppedToolResultCount: 3,
      topDroppedTools: [{ name: "process", count: 3, bytes: expect.any(Number) }],
      classificationReasonCounts: {
        "user-text": 1,
        "successful-tool-output": 3,
        "assistant-text": 1,
      },
    });
  });

  it("preserves workflow signals but never imports recalled memory blocks as source truth", async () => {
    const fixture = writePiTranscriptFixture("quality-workflow-recall", [
      recalledMemoryBlock("r1"),
      userMessage("u1", "Start issue #248 slice 1 on branch feat/memory-quality-fixtures-248."),
      assistantMessage(
        "a1",
        "Opened PR #251, commit abc1234, verification: npm run check passed; follow-up: add recall fixture.",
      ),
    ]);
    const client = captureRetainClient();

    const result = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "bank",
      config: DEFAULT_CONFIG,
      client,
    });

    expect(result.documents[0]).toMatchObject({
      rawMessageCount: 2,
      projectedMessageCount: 2,
      droppedToolResultCount: 0,
      classificationReasonCounts: {
        "user-text": 1,
        "assistant-text": 1,
      },
    });
    const retained = client.retained[0]!.content;
    expect(retained).toContain("issue #248");
    expect(retained).toContain("PR #251");
    expect(retained).toContain("verification: npm run check passed");
    expect(retained).not.toContain("hindsight-memory");
    expect(retained).not.toContain("previous retained fact");
  });
});
