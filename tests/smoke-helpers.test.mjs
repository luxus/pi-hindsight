import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupSmokeBankOnSuccess,
  createSmokeRecorder,
  envValue,
  logStep,
  renderSmokeSummary,
  retry,
  smokeConfig,
  smokeMarker,
  writeGitHubSummary,
} from "../scripts/smoke-helpers.mjs";

describe("smoke helpers", () => {
  it("normalizes empty env values", () => {
    expect(envValue("KEY", { KEY: " value " })).toBe("value");
    expect(envValue("KEY", { KEY: "   " })).toBeUndefined();
    expect(envValue("KEY", {})).toBeUndefined();
  });

  it("builds smoke config with defaults and overrides", () => {
    expect(smokeConfig({}, 123)).toMatchObject({
      baseUrl: "http://localhost:8888",
      bankId: "pi-hindsight-smoke-123",
      bankIsTemporary: true,
      attempts: 20,
      cleanupTimeoutMs: 5000,
    });
    expect(
      smokeConfig(
        {
          HINDSIGHT_BASE_URL: " https://h.example ",
          HINDSIGHT_API_KEY: " key ",
          PI_HINDSIGHT_SMOKE_BANK_ID: " bank ",
          HINDSIGHT_SMOKE_ATTEMPTS: "3",
        },
        123,
      ),
    ).toEqual({
      baseUrl: "https://h.example",
      apiKey: "key",
      bankId: "bank",
      bankIsTemporary: false,
      attempts: 3,
      cleanupTimeoutMs: 5000,
    });
  });

  it("creates deterministic markers when clock/random are injected", () => {
    expect(smokeMarker(123, 0.5)).toBe("pi-hindsight-smoke-123-8");
  });

  it("logs JSON step lines", () => {
    const output = vi.fn();
    logStep("retain_ok", { marker: "m" }, output);
    expect(output).toHaveBeenCalledWith('{"step":"retain_ok","marker":"m"}');
  });

  it("retries until predicate passes", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => fn.mock.calls.length);
    const onWait = vi.fn();
    const resultPromise = retry(fn, (value) => value === 3, { attempts: 4, delayMs: 10, onWait });
    await vi.advanceTimersByTimeAsync(20);
    await expect(resultPromise).resolves.toBe(3);
    expect(onWait).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws after retry attempts are exhausted", async () => {
    await expect(
      retry(
        async () => "no",
        () => false,
        { attempts: 2, delayMs: 0 },
      ),
    ).rejects.toThrow("retry predicate failed after 2 attempts");
  });

  it("supports caller-specific failure messages", async () => {
    await expect(
      retry(
        async () => "no",
        () => false,
        {
          attempts: 2,
          delayMs: 0,
          failureMessage: ({ attempts, preview }) => `custom ${attempts}: ${preview}`,
        },
      ),
    ).rejects.toThrow('custom 2: "no"');
  });

  it("records timed steps while preserving JSONL output", () => {
    const output = vi.fn();
    let now = 100;
    const recorder = createSmokeRecorder({ now: () => now, output });
    now = 125;
    recorder.step("retain_ok", { marker: "m" });

    expect(output).toHaveBeenCalledWith('{"step":"retain_ok","durationMs":25,"marker":"m"}');
    expect(recorder.entries()).toEqual([{ step: "retain_ok", durationMs: 25, marker: "m" }]);
  });

  it("renders GitHub summary markdown", () => {
    expect(renderSmokeSummary([{ step: "retain_ok", durationMs: 25, marker: "m" }])).toContain(
      "| retain_ok | 25ms | `",
    );
  });

  it("writes GitHub summary when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoke-summary-"));
    const path = join(dir, "summary.md");

    await expect(writeGitHubSummary("hello\n", { GITHUB_STEP_SUMMARY: path })).resolves.toEqual({
      written: true,
    });
    await expect(readFile(path, "utf8")).resolves.toBe("hello\n");
    await expect(writeGitHubSummary("hello\n", {})).resolves.toEqual({ written: false });
    await expect(
      writeGitHubSummary("hello\n", { GITHUB_STEP_SUMMARY: join(dir, "missing", "summary.md") }),
    ).resolves.toMatchObject({ written: false, error: expect.any(String) });
  });

  it("cleans up temporary smoke bank only after success", async () => {
    const recorder = createSmokeRecorder({ now: () => 0, output: () => undefined });
    const deleteBank = vi.fn(async () => ({ status: 204 }));
    await expect(
      cleanupSmokeBankOnSuccess({
        config: { bankIsTemporary: true },
        bankId: "bank",
        succeeded: true,
        recorder,
        deleteBank,
      }),
    ).resolves.toEqual({ cleaned: true, status: 204 });
    expect(deleteBank).toHaveBeenCalledWith(
      { bankIsTemporary: true },
      "bank",
      expect.any(AbortSignal),
    );
    expect(recorder.entries().at(-1)).toMatchObject({ step: "cleanup_ok", bankId: "bank" });
  });

  it("keeps smoke artifacts on failure or configured bank", async () => {
    const output = vi.fn();
    const recorder = createSmokeRecorder({ now: () => 0, output });
    const deleteBank = vi.fn(async () => ({ status: 204 }));

    await cleanupSmokeBankOnSuccess({
      config: { bankIsTemporary: true },
      bankId: "bank",
      succeeded: false,
      recorder,
      deleteBank,
    });
    await cleanupSmokeBankOnSuccess({
      config: { bankIsTemporary: false },
      bankId: "bank",
      succeeded: true,
      recorder,
      deleteBank,
    });

    expect(deleteBank).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      '{"step":"cleanup_skipped","durationMs":0,"reason":"smoke_failed","bankId":"bank"}',
    );
    expect(output).toHaveBeenCalledWith(
      '{"step":"cleanup_skipped","durationMs":0,"reason":"configured_bank","bankId":"bank"}',
    );
  });

  it("logs cleanup failures without throwing", async () => {
    const recorder = createSmokeRecorder({ now: () => 0, output: () => undefined });
    await expect(
      cleanupSmokeBankOnSuccess({
        config: { bankIsTemporary: true },
        bankId: "bank",
        succeeded: true,
        recorder,
        deleteBank: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toMatchObject({ cleaned: false, reason: "delete_failed", error: "boom" });
    expect(recorder.entries().at(-1)).toMatchObject({ step: "cleanup_failed", error: "boom" });
  });

  it("passes a bounded abort signal to cleanup", async () => {
    const recorder = createSmokeRecorder({ now: () => 0, output: () => undefined });
    const deleteBank = vi.fn(async (_config, _bankId, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return { status: 204 };
    });
    await cleanupSmokeBankOnSuccess({
      config: { bankIsTemporary: true, cleanupTimeoutMs: 1 },
      bankId: "bank",
      succeeded: true,
      recorder,
      deleteBank,
    });
    expect(deleteBank).toHaveBeenCalledOnce();
  });
});
