import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { collectStatusHealthFacts } from "../extensions/utils/status-health.js";
import type { HindsightLikeClient } from "../extensions/types.js";

describe("status health", () => {
  it("reports server, bank reachability, and bank stats", async () => {
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getVersion: vi.fn(async () => ({
        api_version: "0.8.3",
        features: { observations: true, mcp: false, worker: true, bank_config_api: false },
      })),
      getBankProfile: vi.fn(async (bankId: string) => ({
        bank_id: bankId,
        name: `${bankId} name`,
      })),
      getBankConfig: vi.fn(async () => ({
        config: {
          retain_custom_instructions: "Extract from db",
          reflect_mission: "Reflect from db",
        },
        overrides: { retain_custom_instructions: "Override retain from db" },
      })),
      getBankStats: vi.fn(async () => ({
        total_nodes: 3,
        total_documents: 2,
        total_observations: 1,
        fact_count: 5,
        pending_consolidation: 4,
        failed_consolidation: 0,
        last_document_at: "2026-05-08T00:00:00Z",
      })),
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: {
        ...DEFAULT_CONFIG,
        banks: {
          ...DEFAULT_CONFIG.banks,
          user: { enabled: true, bankId: "global-bank" },
        },
      },
      projectBankId: "project-bank",
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        ["Server", "reachable"],
        ["Server version", "0.8.3 · features: observations, worker"],
        ["Project bank", "reachable · project-bank · Project → Bank: project-bank"],
        ["User bank", "reachable · global-bank · User → Bank: global-bank"],
        ["Project bank config", "Bank overrides: 1 · Resolved config fields: 2"],
        ["User bank config", "Bank overrides: 1 · Resolved config fields: 2"],
        ["Project bank missions", "db · retain Override retain from db · reflect Reflect from db"],
        [
          "Project bank stats",
          "memories 3 · docs 2 · observations 1 · facts 5 · pending 4 · failed 0 · last document 2026-05-08T00:00:00Z",
        ],
      ]),
    );
  });

  it("reports unreachable server and bank without throwing", async () => {
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => {
        throw new Error("down");
      }),
      getBankProfile: vi.fn(async () => {
        throw new Error("missing bank");
      }),
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Server")?.[1]).toContain("unreachable");
    expect(facts.find(([key]) => key === "Project bank")?.[1]).toContain("unreachable");
  });

  it("omits server version when getVersion is unavailable", async () => {
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getBankProfile: vi.fn(async (bankId: string) => ({ bank_id: bankId, name: bankId })),
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Server")?.[1]).toBe("reachable");
    expect(facts.some(([key]) => key === "Server version")).toBe(false);
  });

  it("degrades silently when getVersion throws or returns no api_version", async () => {
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getVersion: vi.fn(async () => {
        throw new Error("no /version endpoint");
      }),
      getBankProfile: vi.fn(async (bankId: string) => ({ bank_id: bankId, name: bankId })),
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Server")?.[1]).toBe("reachable");
    expect(facts.some(([key]) => key === "Server version")).toBe(false);
  });

  it("uses list-banks exact bank_id and still loads config when profile returns 410", async () => {
    const getBankProfile = vi.fn(async () => {
      throw Object.assign(new Error("The bank profile endpoints have been removed."), {
        status: 410,
      });
    });
    const getBankConfig = vi.fn(async () => ({
      config: { retain_mission: "From config" },
      overrides: {},
    }));
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getBankProfile,
      listBanks: vi.fn(async () => ({ banks: [{ bank_id: "bank" }] })),
      getBankConfig,
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Project bank")?.[1]).toContain("reachable");
    expect(facts.find(([key]) => key === "Project bank missions")?.[1]).toContain("From config");
    expect(getBankProfile).not.toHaveBeenCalled();
    expect(getBankConfig).toHaveBeenCalledWith("bank");
  });

  it("does not treat GET /config as existence when list-banks misses", async () => {
    const getBankConfig = vi.fn(async () => ({
      config: { retain_mission: "Config 200s for missing banks" },
      overrides: {},
    }));
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getBankProfile: vi.fn(async () => {
        throw Object.assign(new Error("The bank profile endpoints have been removed."), {
          status: 410,
        });
      }),
      listBanks: vi.fn(async () => ({ banks: [{ bank_id: "bank-extra" }] })),
      getBankConfig,
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Project bank")?.[1]).toContain("unreachable · not found");
    expect(facts.some(([key]) => key === "Project bank missions")).toBe(false);
    expect(getBankConfig).not.toHaveBeenCalled();
  });

  it("continues to config/stats when profile is retired and list-banks is unavailable", async () => {
    const getBankConfig = vi.fn(async () => ({
      config: { reflect_mission: "Still readable" },
      overrides: {},
    }));
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      getBankProfile: vi.fn(async () => {
        throw Object.assign(new Error("The bank profile endpoints have been removed."), {
          statusCode: 410,
        });
      }),
      getBankConfig,
    };

    const facts = await collectStatusHealthFacts({
      client,
      config: DEFAULT_CONFIG,
      projectBankId: "bank",
    });

    expect(facts.find(([key]) => key === "Project bank")?.[1]).toContain("reachable · bank");
    expect(facts.find(([key]) => key === "Project bank missions")?.[1]).toContain("Still readable");
    expect(getBankConfig).toHaveBeenCalledWith("bank");
  });
});
