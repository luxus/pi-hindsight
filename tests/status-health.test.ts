import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { collectStatusHealthFacts } from "../extensions/status-health.js";
import type { HindsightLikeClient } from "../extensions/types.js";

describe("status health", () => {
  it("reports server, bank reachability, and bank stats", async () => {
    const client: HindsightLikeClient = {
      retain: vi.fn(),
      retainBatch: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
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
        ["Project bank", "reachable · project-bank name · Project → Bank: project-bank"],
        ["User bank", "reachable · global-bank name · User → Bank: global-bank"],
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
});
