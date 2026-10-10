import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  advanceRetainCursor,
  filterNewRetainMessages,
  messageFingerprint,
  readSessionRetainState,
  retainedThroughIndex,
  retainCursorPath,
  RETAIN_CURSOR_TAIL_WINDOW,
  RETAIN_CURSOR_VERSION,
} from "../extensions/lifecycle/retain-cursor.js";

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  timestamp: number,
): AgentMessage {
  return { id, role, content, timestamp } as AgentMessage;
}

function transcript(count: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push(msg(`m${i}`, role, `message-${i}`, i + 1));
  }
  return messages;
}

describe("retain cursor", () => {
  it("never re-retains messages beyond a monotonic index for long sessions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "long-session";
    const messages = transcript(2_500);

    await advanceRetainCursor(cwd, sessionId, messages, messages.length - 1);

    const state = await readSessionRetainState(cwd, sessionId);
    expect(state?.cursor?.index).toBe(2_499);
    expect(state?.cursor?.fingerprints.length).toBeLessThanOrEqual(RETAIN_CURSOR_TAIL_WINDOW);
    expect(state?.cursor?.messageIds.length).toBeLessThanOrEqual(RETAIN_CURSOR_TAIL_WINDOW);
    expect(filterNewRetainMessages(messages, state)).toEqual([]);
  });

  it("survives process restarts without duplicate retain bursts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "restart-session";
    const firstTurn = transcript(4);
    const secondTurn = transcript(6);

    await advanceRetainCursor(cwd, sessionId, firstTurn, firstTurn.length - 1);

    const reloaded = await readSessionRetainState(cwd, sessionId);
    expect(filterNewRetainMessages(firstTurn, reloaded)).toEqual([]);
    expect(filterNewRetainMessages(secondTurn, reloaded)).toEqual(secondTurn.slice(4));
  });

  it("migrates legacy fingerprint stores without duplicate retain bursts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "legacy-session";
    const messages = transcript(6);
    const legacyFingerprints = messages.slice(0, 4).map(messageFingerprint);

    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      retainCursorPath(cwd),
      `${JSON.stringify({ sessions: { [sessionId]: legacyFingerprints } }, null, 2)}\n`,
      "utf8",
    );

    const migrated = await readSessionRetainState(cwd, sessionId);
    expect(filterNewRetainMessages(messages, migrated)).toEqual(messages.slice(4));

    await advanceRetainCursor(cwd, sessionId, messages, messages.length - 1);
    const stored = JSON.parse(readFileSync(retainCursorPath(cwd), "utf8")) as {
      version: number;
      sessions: Record<string, unknown>;
    };
    expect(stored.version).toBe(RETAIN_CURSOR_VERSION);
    expect(stored.sessions[sessionId]).toMatchObject({ index: 5 });
    expect(stored.sessions[sessionId]).not.toHaveProperty("legacyFingerprints");
  });

  it("migrates over-cap legacy stores from the end without a full-transcript burst", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "legacy-over-cap";
    const messages = transcript(8);
    const legacyFingerprints = messages.slice(6).map(messageFingerprint);

    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      retainCursorPath(cwd),
      `${JSON.stringify({ sessions: { [sessionId]: legacyFingerprints } }, null, 2)}\n`,
      "utf8",
    );

    const migrated = await readSessionRetainState(cwd, sessionId);
    expect(filterNewRetainMessages(messages, migrated)).toEqual(messages.slice(8));
  });

  it("retains edited messages while keeping earlier dedupe", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "edit-session";
    const original = transcript(4);
    const edited = [
      ...original.slice(0, 2),
      msg("m2", "assistant", "message-2-edited", 3),
      ...original.slice(3),
    ];

    await advanceRetainCursor(cwd, sessionId, original, original.length - 1);
    const state = await readSessionRetainState(cwd, sessionId);

    expect(filterNewRetainMessages(edited, state)).toEqual([edited[2]]);
  });

  it("does not re-retain unchanged suffix after edit mark cycle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "edit-mark-cycle";
    const original = transcript(4);
    const edited = [
      ...original.slice(0, 2),
      msg("m2", "assistant", "message-2-edited", 3),
      ...original.slice(3),
    ];

    await advanceRetainCursor(cwd, sessionId, original, original.length - 1);
    const afterFullRetain = await readSessionRetainState(cwd, sessionId);
    expect(filterNewRetainMessages(edited, afterFullRetain)).toEqual([edited[2]]);

    const editedBatch = [edited[2]!];
    const throughIndex = retainedThroughIndex(edited, editedBatch);
    await advanceRetainCursor(cwd, sessionId, edited, throughIndex);

    const afterEditMark = await readSessionRetainState(cwd, sessionId);
    expect(afterEditMark?.cursor?.index).toBe(3);
    expect(filterNewRetainMessages(edited, afterEditMark)).toEqual([]);
  });

  it("clamps cursor index when a shorter branch replaces a longer retained transcript", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "shrink-branch";
    const original = transcript(10);
    const shortBranch = [
      ...original.slice(0, 3),
      msg("m3b", "assistant", "branched-response", 4),
      msg("m4", "user", "message-4", 5),
    ];

    await advanceRetainCursor(cwd, sessionId, original, original.length - 1);
    const beforeShrink = await readSessionRetainState(cwd, sessionId);
    expect(beforeShrink?.cursor?.index).toBe(9);

    await advanceRetainCursor(cwd, sessionId, shortBranch, shortBranch.length - 1);
    const afterShrink = await readSessionRetainState(cwd, sessionId);

    expect(afterShrink?.cursor?.index).toBe(shortBranch.length - 1);
    expect(filterNewRetainMessages(shortBranch, afterShrink)).toEqual([]);
  });

  it("retains branched suffixes without replaying the shared prefix", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "branch-session";
    const original = transcript(5);
    const branched = [
      ...original.slice(0, 3),
      msg("m3b", "assistant", "branched-response", 4),
      msg("m4", "user", "message-4", 5),
    ];

    await advanceRetainCursor(cwd, sessionId, original, original.length - 1);
    const state = await readSessionRetainState(cwd, sessionId);

    expect(filterNewRetainMessages(branched, state)).toEqual(branched.slice(3));
  });

  it("returns -1 from retainedThroughIndex when the batch is not found", () => {
    const messages = transcript(4);
    const missing = [msg("missing", "assistant", "not-in-transcript", 99)];
    expect(retainedThroughIndex(messages, missing)).toBe(-1);
  });

  it("uses forward id+fingerprint match instead of a later duplicate", () => {
    const duplicateContent = msg("dup", "assistant", "same-content", 2);
    const messages = [
      msg("m0", "user", "message-0", 1),
      duplicateContent,
      msg("m2", "user", "message-2", 3),
      msg("dup-later", "assistant", "same-content", 4),
    ];
    expect(retainedThroughIndex(messages, [duplicateContent])).toBe(1);
  });

  it("recovers the first JSON document when torn writes leave trailing bytes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    const sessionId = "torn-tail";
    const messages = transcript(6);

    await advanceRetainCursor(cwd, sessionId, messages, messages.length - 1);
    const raw = readFileSync(retainCursorPath(cwd), "utf8");
    // Simulate a torn non-atomic overwrite: a complete JSON document followed
    // by trailing bytes from an older, longer store that a shorter write
    // never truncated away. A strict JSON.parse of the whole file throws
    // "Unexpected non-whitespace character after JSON" and aborts the run.
    writeFileSync(
      retainCursorPath(cwd),
      `${raw}0ef583dc…trailing garbage from an older store\n`,
      "utf8",
    );

    const state = await readSessionRetainState(cwd, sessionId);
    expect(state?.cursor?.index).toBe(messages.length - 1);
    expect(filterNewRetainMessages(messages, state)).toEqual([]);
  });

  it("still rejects a store whose first JSON document is unusable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-cursor-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(retainCursorPath(cwd), '{"version": 3, "sessions": {"x": {"ind', "utf8");

    await expect(readSessionRetainState(cwd, "x")).rejects.toBeInstanceOf(SyntaxError);
  });
});
