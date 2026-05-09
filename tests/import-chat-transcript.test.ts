import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { readRetainQueue, resolveQueuePath } from "../extensions/queue.js";
import {
  importChatTranscript,
  parseChatTranscriptJsonl,
} from "../extensions/import-chat-transcript.js";
import { importMemoryChatTranscript } from "../extensions/import-operations.js";

describe("chat transcript import", () => {
  it("parses high-signal chat transcript events and drops stream noise", () => {
    const parsed = parseChatTranscriptJsonl(
      [
        JSON.stringify({ type: "user_message", content: "hi", channel: "telegram" }),
        JSON.stringify({ type: "message_update", content: "partial" }),
        JSON.stringify({ event: "assistant_reply", content: "hello" }),
        JSON.stringify({ kind: "process_end", output: "done" }),
        JSON.stringify({ type: "extension_ui_request", content: "noise" }),
        "{bad",
      ].join("\n"),
    );

    expect(parsed.kept.map((event) => event.type)).toEqual([
      "user_message",
      "assistant_reply",
      "process_end",
    ]);
    expect(parsed.droppedEventCount).toBe(2);
    expect(parsed.droppedEventTypes).toEqual([
      { type: "extension_ui_request", count: 1 },
      { type: "message_update", count: 1 },
    ]);
    expect(parsed.malformedLineCount).toBe(1);
  });

  it("dry-runs chat transcript import with user-memory provenance metrics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          type: "user_message",
          content: "prefer concise replies",
          channel: "telegram",
          session_id: "s1",
          conversation_id: "c1",
        }),
        JSON.stringify({ type: "message_update", content: "streaming" }),
        JSON.stringify({ type: "assistant_reply", content: "Noted.", channel: "telegram" }),
        JSON.stringify({ type: "process_end", output: "ok" }),
      ].join("\n"),
    );

    const result = await importChatTranscript({
      sourceFile,
      cwd: dir,
      bankId: "user-bank",
      config: DEFAULT_CONFIG,
      dryRun: true,
      client: { retain: async () => undefined, recall: async () => [], reflect: async () => ({}) },
    });

    expect(result).toMatchObject({
      bankId: "user-bank",
      retained: false,
      dryRun: true,
      keptEventCount: 3,
      droppedEventCount: 1,
      retainedTurnCount: 1,
      malformedLineCount: 0,
      contentHash: expect.any(String),
      contentBytes: expect.any(Number),
    });
    expect(result.documentId).toMatch(/^pi-chat-import:/);
  });

  it("skips noise-only chat transcript without writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-empty-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({ type: "message_update", content: "stream" }),
        JSON.stringify({ type: "extension_ui_request", content: "ui" }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importChatTranscript({
      sourceFile,
      cwd: dir,
      bankId: "user-bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result).toMatchObject({
      retained: false,
      skipped: true,
      skipReason: "No high-signal chat transcript events found.",
      keptEventCount: 0,
      droppedEventCount: 2,
    });
    expect(calls).toEqual([]);
  });

  it("imports chat transcript using replace mode and chat tags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-retain-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({ type: "user_message", content: "remember tone", channel: "sms" }),
        JSON.stringify({ type: "assistant_reply", content: "Stored." }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importChatTranscript({
      sourceFile,
      cwd: dir,
      bankId: "user-bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.retained).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("user-bank");
    expect(calls[0]?.[2]).toMatchObject({
      documentId: result.documentId,
      updateMode: "replace",
      tags: expect.arrayContaining(["source:chat", "import:chat", "channel:sms"]),
      metadata: expect.objectContaining({
        source: "pi-hindsight",
        retainSource: "import",
        imported: "true",
        source_file: sourceFile,
        channel: "sms",
      }),
    });
  });

  it("queues chat transcript imports with import identity metadata for retry dedupe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-queued-identity-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({ type: "user_message", content: "remember identity", channel: "sms" }),
        JSON.stringify({ type: "assistant_reply", content: "Stored." }),
      ].join("\n"),
    );
    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);

    await expect(
      importChatTranscript({
        sourceFile,
        cwd: dir,
        bankId: "user-bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => {
            throw new Error("offline");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);

    const queued = await readRetainQueue(queuePath);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      bankId: "user-bank",
      updateMode: "replace",
      item: {
        metadata: expect.objectContaining({
          source: "pi-hindsight",
          retainSource: "import",
          imported: "true",
          source_file: sourceFile,
          channel: "sms",
          content_hash: expect.any(String),
        }),
        tags: expect.arrayContaining(["source:chat", "import:chat", "imported:true"]),
      },
    });
  });

  it("drops stale queued chat transcript import jobs before retrying changed content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-stale-queue-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    const writeChat = (middleContent: string) =>
      writeFileSync(
        sourceFile,
        [
          JSON.stringify({ type: "user_message", content: "same first", channel: "sms" }),
          JSON.stringify({ type: "assistant_reply", content: middleContent }),
          JSON.stringify({ type: "process_end", output: "same last" }),
        ].join("\n"),
      );
    writeChat("OLD_MIDDLE");
    const queuePath = resolveQueuePath(dir, DEFAULT_CONFIG.retain.queuePath);

    await expect(
      importChatTranscript({
        sourceFile,
        cwd: dir,
        bankId: "user-bank",
        config: DEFAULT_CONFIG,
        client: {
          retain: async () => {
            throw new Error("offline");
          },
          recall: async () => [],
          reflect: async () => ({}),
        },
      }),
    ).rejects.toThrow(/queued/);
    const oldQueued = await readRetainQueue(queuePath);
    expect(oldQueued[0]?.item.content).toContain("OLD_MIDDLE");

    writeChat("NEW_MIDDLE");
    const calls: unknown[][] = [];
    const result = await importChatTranscript({
      sourceFile,
      cwd: dir,
      bankId: "user-bank",
      config: DEFAULT_CONFIG,
      client: {
        retain: async (...args: unknown[]) => {
          calls.push(args);
        },
        recall: async () => [],
        reflect: async () => ({}),
      },
    });

    expect(result.retained).toBe(true);
    expect(calls).toHaveLength(1);
    const retainedContent = calls[0]?.[1] as string;
    const retainedOptions = calls[0]?.[2] as { metadata: Record<string, string> };
    expect(retainedContent).toContain("NEW_MIDDLE");
    expect(retainedContent).not.toContain("OLD_MIDDLE");
    expect(retainedOptions.metadata.content_hash).toBe(result.contentHash);
    await expect(readRetainQueue(queuePath)).resolves.toEqual([]);
  });

  it("defaults operation imports to configured user bank", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-chat-operation-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "chat.jsonl");
    writeFileSync(sourceFile, JSON.stringify({ type: "user_message", content: "save user pref" }));

    const result = await importMemoryChatTranscript(
      { sourceFile, cwd: dir, dryRun: true },
      {
        getClient: () => ({
          retain: async () => undefined,
          recall: async () => [],
          reflect: async () => ({}),
        }),
        getProjectBankId: () => "project-bank",
        getConfig: () => ({
          ...DEFAULT_CONFIG,
          banks: {
            ...DEFAULT_CONFIG.banks,
            user: { enabled: true, bankId: "configured-user-bank" },
            global: { enabled: true, bankId: "configured-user-bank" },
          },
        }),
      },
    );

    expect(result.bankId).toBe("configured-user-bank");
    expect(result.keptEventCount).toBe(1);
  });
});
