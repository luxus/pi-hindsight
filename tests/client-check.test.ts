import { describe, expect, it, vi } from "vitest";
import { checkHindsight } from "../extensions/client/client.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function baseClient(overrides: Partial<HindsightLikeClient> = {}): HindsightLikeClient {
  return {
    retain: vi.fn(),
    retainBatch: vi.fn(),
    recall: vi.fn(async () => []),
    reflect: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("checkHindsight", () => {
  it("uses health when present and skips list-banks and profile", async () => {
    const health = vi.fn(async () => ({ ok: true }));
    const listBanks = vi.fn();
    const getBankProfile = vi.fn();
    const result = await checkHindsight(baseClient({ health, listBanks, getBankProfile }), "bank");
    expect(result).toEqual({ ok: true });
    expect(health).toHaveBeenCalledOnce();
    expect(listBanks).not.toHaveBeenCalled();
    expect(getBankProfile).not.toHaveBeenCalled();
  });

  it("falls back to list-banks when health is missing", async () => {
    const listBanks = vi.fn(async () => ({ banks: [{ bank_id: "bank" }] }));
    const getBankProfile = vi.fn();
    const result = await checkHindsight(baseClient({ listBanks, getBankProfile }), "bank");
    expect(result).toEqual({ ok: true });
    expect(listBanks).toHaveBeenCalledWith({ q: "bank", limit: 1 });
    expect(getBankProfile).not.toHaveBeenCalled();
  });

  it("treats retired profile 410 as reachable when health and list-banks are missing", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("The bank profile endpoints have been removed."), {
        status: 410,
      });
    });
    const recall = vi.fn();
    const result = await checkHindsight(baseClient({ getBankProfile, recall }), "bank");
    expect(result).toEqual({ ok: true });
    expect(getBankProfile).toHaveBeenCalledWith("bank");
    expect(recall).not.toHaveBeenCalled();
  });

  it("still reports profile failures other than 410", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("down"), { status: 503 });
    });
    const result = await checkHindsight(baseClient({ getBankProfile }), "bank");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("down");
  });
});
