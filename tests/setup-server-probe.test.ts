import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config-defaults.js";
import {
  buildServerProbeCandidates,
  formatServerProbeDocs,
  formatServerProbeFailure,
  formatServerProbeSuccess,
  hasResolvedApiKey,
  LOCAL_DEFAULT_BASE_URL,
  probeHindsightCandidates,
} from "../extensions/tui/setup-server-probe.js";

describe("setup server probe", () => {
  it("prefers configured URL and falls back to localhost when different", () => {
    expect(
      buildServerProbeCandidates({
        ...DEFAULT_CONFIG,
        hindsight: { ...DEFAULT_CONFIG.hindsight, baseUrl: "https://api.example.com/" },
      }),
    ).toEqual(["https://api.example.com", LOCAL_DEFAULT_BASE_URL]);
    expect(buildServerProbeCandidates(DEFAULT_CONFIG)).toEqual([LOCAL_DEFAULT_BASE_URL]);
  });

  it("detects resolved API keys", () => {
    expect(hasResolvedApiKey(DEFAULT_CONFIG)).toBe(false);
    expect(
      hasResolvedApiKey({
        ...DEFAULT_CONFIG,
        hindsight: { ...DEFAULT_CONFIG.hindsight, apiKey: "secret" },
      }),
    ).toBe(true);
  });

  it("formats success, failure, and docs copy", () => {
    expect(
      formatServerProbeSuccess({
        ok: true,
        baseUrl: LOCAL_DEFAULT_BASE_URL,
        usedApiKey: false,
      }),
    ).toContain("reachable");
    expect(formatServerProbeDocs()).toContain(
      "https://luxus.github.io/pi-hindsight/start/setup-tui/",
    );
    expect(formatServerProbeDocs()).toContain("ui.hindsight.vectorize.io/signup");
    expect(
      formatServerProbeFailure({
        results: [
          {
            ok: false,
            baseUrl: LOCAL_DEFAULT_BASE_URL,
            usedApiKey: false,
            error: "ECONNREFUSED",
          },
        ],
        hasApiKey: false,
        apiKeyEnvLabel: "HINDSIGHT_API_KEY",
      }),
    ).toMatch(/Could not reach|ECONNREFUSED|HINDSIGHT_API_KEY/s);
  });

  it("returns first healthy candidate", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "down" })
      .mockResolvedValueOnce({ ok: true });
    const createClient = vi.fn(() => ({
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
    }));
    const { ok, attempts } = await probeHindsightCandidates({
      config: {
        ...DEFAULT_CONFIG,
        hindsight: { ...DEFAULT_CONFIG.hindsight, baseUrl: "https://api.example.com" },
      },
      createClient,
      check,
    });
    expect(ok?.baseUrl).toBe(LOCAL_DEFAULT_BASE_URL);
    expect(attempts).toHaveLength(2);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
