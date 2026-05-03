import { describe, expect, it, vi } from "vitest";
import { envValue, logStep, retry, smokeConfig, smokeMarker } from "../scripts/smoke-helpers.mjs";

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
      attempts: 20,
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
    ).toEqual({ baseUrl: "https://h.example", apiKey: "key", bankId: "bank", attempts: 3 });
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
});
