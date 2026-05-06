import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  importGatewayTranscript,
  parseGatewayTranscriptJsonl,
} from "../extensions/import-gateway-transcript.js";
import { importMemoryGatewayTranscript } from "../extensions/import-operations.js";

describe("gateway transcript import", () => {
  it("parses high-signal gateway transcript events and drops stream noise", () => {
    const parsed = parseGatewayTranscriptJsonl(
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

  it("dry-runs gateway transcript import with user-memory provenance metrics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-gateway-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "gateway.jsonl");
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

    const result = await importGatewayTranscript({
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
    expect(result.documentId).toMatch(/^pi-gateway-import:/);
  });

  it("skips noise-only gateway transcript without writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-gateway-empty-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "gateway.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({ type: "message_update", content: "stream" }),
        JSON.stringify({ type: "extension_ui_request", content: "ui" }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importGatewayTranscript({
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
      skipReason: "No high-signal gateway events found.",
      keptEventCount: 0,
      droppedEventCount: 2,
    });
    expect(calls).toEqual([]);
  });

  it("imports gateway transcript using replace mode and gateway tags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-gateway-retain-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "gateway.jsonl");
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({ type: "user_message", content: "remember tone", channel: "sms" }),
        JSON.stringify({ type: "assistant_reply", content: "Stored." }),
      ].join("\n"),
    );
    const calls: unknown[][] = [];

    const result = await importGatewayTranscript({
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
      tags: expect.arrayContaining(["source:gateway", "import:gateway", "channel:sms"]),
      metadata: expect.objectContaining({
        source: "pi-hindsight",
        retainSource: "import",
        source_file: sourceFile,
        channel: "sms",
      }),
    });
  });

  it("defaults operation imports to configured user bank", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-hindsight-gateway-operation-"));
    mkdirSync(join(dir, ".git"));
    const sourceFile = join(dir, "gateway.jsonl");
    writeFileSync(sourceFile, JSON.stringify({ type: "user_message", content: "save user pref" }));

    const result = await importMemoryGatewayTranscript(
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
