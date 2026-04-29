import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSessionMemoryTag,
  consumeNextSessionRetainMode,
  getEffectiveSessionMemoryMode,
  readSessionMemoryMeta,
  removeSessionMemoryTag,
  setNextSessionRetainMode,
  setSessionMemoryMode,
  setSessionRetainEnabled,
  sessionMetaPath,
} from "../extensions/session-memory-meta.js";

describe("session memory metadata", () => {
  it("defaults to normal recall and retain", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));
    const meta = await readSessionMemoryMeta(cwd, "/tmp/session.jsonl");
    expect(getEffectiveSessionMemoryMode(meta)).toMatchObject({
      mode: "normal",
      recall: true,
      retain: true,
      tags: [],
    });
  });

  it("persists mode and retain toggles", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "read-only");
    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "read-only",
      recall: true,
      retain: false,
    });
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "ignored");
    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "ignored",
      recall: false,
      retain: false,
    });
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "normal");
    await setSessionRetainEnabled(cwd, "/tmp/session.jsonl", false);
    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "normal",
      recall: true,
      retain: false,
    });
  });

  it("fails closed when sidecar exists but is corrupt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));
    const path = sessionMetaPath(cwd, "/tmp/session.jsonl");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "not json");
    let meta = await readSessionMemoryMeta(cwd, "/tmp/session.jsonl");
    expect(getEffectiveSessionMemoryMode(meta)).toMatchObject({
      mode: "ignored",
      recall: false,
      retain: false,
    });

    writeFileSync(path, JSON.stringify({ mode: "bogus" }));
    meta = await readSessionMemoryMeta(cwd, "/tmp/session.jsonl");
    expect(getEffectiveSessionMemoryMode(meta)).toMatchObject({
      mode: "ignored",
      recall: false,
      retain: false,
    });
  });

  it("restores recall and retain defaults when switching fail-closed metadata to normal", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));
    const path = sessionMetaPath(cwd, "/tmp/session.jsonl");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "not json");

    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "normal");

    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "normal",
      recall: true,
      retain: true,
    });
  });

  it("restores retain defaults when switching ignored mode to normal", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));

    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "ignored");
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "normal");

    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "normal",
      recall: true,
      retain: true,
    });
  });

  it("preserves explicit retain off when switching modes back to normal", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));

    await setSessionRetainEnabled(cwd, "/tmp/session.jsonl", false);
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "read-only");
    await setSessionMemoryMode(cwd, "/tmp/session.jsonl", "normal");

    expect(
      getEffectiveSessionMemoryMode(await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")),
    ).toMatchObject({
      mode: "normal",
      recall: true,
      retain: false,
    });
  });

  it("persists and consumes one-turn retain opt-out", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));

    await setNextSessionRetainMode(cwd, "/tmp/session.jsonl", "off");
    expect((await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")).nextRetainMode).toBe("off");

    const consumed = await consumeNextSessionRetainMode(cwd, "/tmp/session.jsonl");
    expect(consumed.consumed).toBe("off");
    expect(consumed.meta.nextRetainMode).toBe("normal");
    expect((await readSessionMemoryMeta(cwd, "/tmp/session.jsonl")).nextRetainMode).toBe("normal");
  });

  it("adds and removes sanitized tags", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-meta-"));
    await addSessionMemoryTag(cwd, undefined, " domain:test ");
    await addSessionMemoryTag(cwd, undefined, "domain:test");
    await addSessionMemoryTag(cwd, undefined, "bad\n");
    let meta = await readSessionMemoryMeta(cwd);
    expect(meta.tags).toEqual(["domain:test"]);
    await removeSessionMemoryTag(cwd, undefined, "domain:test");
    meta = await readSessionMemoryMeta(cwd);
    expect(meta.tags).toEqual([]);
    expect(sessionMetaPath(cwd)).toContain(".pi/hindsight/session-meta/");
  });
});
