import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fsState = vi.hoisted(() => ({
  abortAfterWrite: false,
  controller: undefined as AbortController | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (
      file: Parameters<typeof actual.writeFile>[0],
      data: Parameters<typeof actual.writeFile>[1],
      options?: Parameters<typeof actual.writeFile>[2],
    ) => {
      if (fsState.abortAfterWrite && fsState.controller) {
        await actual.writeFile(
          file,
          data,
          typeof options === "string" ? options : { encoding: "utf8" },
        );
        fsState.controller.abort();
        const error = new Error("hindsight last-recall snapshot aborted");
        error.name = "AbortError";
        throw error;
      }
      return actual.writeFile(file, data, options);
    },
  };
});

const { readLastRecallSnapshot, resolveLastRecallPath, writeLastRecallSnapshot } =
  await import("../extensions/lifecycle/recall-visibility.js");

describe("last-recall snapshot writes", () => {
  afterEach(() => {
    fsState.abortAfterWrite = false;
    fsState.controller = undefined;
  });

  it("does not replace an existing snapshot when already aborted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-vis-"));
    const configuredPath = "last-recall.json";
    await writeLastRecallSnapshot(cwd, configuredPath, {
      query: "old",
      rendered: "previous",
      blocks: [],
      failed: 0,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeLastRecallSnapshot(
        cwd,
        configuredPath,
        { query: "new", rendered: "cancelled", blocks: [], failed: 0 },
        controller.signal,
      ),
    ).rejects.toThrow(/aborted/);
    const snapshot = await readLastRecallSnapshot(cwd, configuredPath);
    expect(snapshot?.query).toBe("old");
    expect(snapshot?.rendered).toBe("previous");
    expect(readdirSync(cwd).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("discards the temp file and keeps the previous snapshot when abort races rename", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-recall-vis-"));
    const configuredPath = "last-recall.json";
    await writeLastRecallSnapshot(cwd, configuredPath, {
      query: "old",
      rendered: "previous",
      blocks: [],
      failed: 0,
    });
    const dest = resolveLastRecallPath(cwd, configuredPath);
    const previous = readFileSync(dest, "utf8");
    const controller = new AbortController();
    fsState.controller = controller;
    fsState.abortAfterWrite = true;
    await expect(
      writeLastRecallSnapshot(
        cwd,
        configuredPath,
        { query: "new", rendered: "cancelled", blocks: [], failed: 1 },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(readFileSync(dest, "utf8")).toBe(previous);
    expect(readdirSync(cwd).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
