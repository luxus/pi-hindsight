import { describe, expect, it } from "vitest";
import { handleMentalModels } from "../extensions/setup-tui-mental-models.js";
import { DEFAULT_CONFIG } from "../extensions/config-defaults.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";
import type { MemoryOperationsDeps } from "../extensions/memory-operation-service.js";

function clientWith(overrides: Partial<HindsightLikeClient>): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => "",
    reflect: async () => "",
    ...overrides,
  };
}

function deps(
  client: HindsightLikeClient,
  config: ResolvedConfig = DEFAULT_CONFIG,
): MemoryOperationsDeps {
  return {
    getConfig: () => config,
    getProjectBankId: () => "project-bank",
    getClient: () => client,
  };
}

function ctx(selects: string[], inputs: string[] = []) {
  const notifications: Array<{ message: string; level: string }> = [];
  const prompts: Array<{ prompt: string; fallback?: string }> = [];
  return {
    ctx: {
      cwd: "/repo",
      ui: {
        select: async () => selects.shift(),
        input: async (prompt: string, fallback?: string) => {
          prompts.push(fallback === undefined ? { prompt } : { prompt, fallback });
          return inputs.shift();
        },
        notify: (message: string, level: string) => notifications.push({ message, level }),
      },
    },
    notifications,
    prompts,
  };
}

const listResponse = {
  items: [{ id: "model-1", name: "Project model", tags: ["project"], is_stale: false }],
};

describe("setup TUI mental models", () => {
  it("views model content through project bank alias", async () => {
    const calls: Array<{ method: string; bank: string; id?: string }> = [];
    const client = clientWith({
      listMentalModels: async (bank) => {
        calls.push({ method: "list", bank });
        return listResponse;
      },
      getMentalModel: async (bank, id) => {
        calls.push({ method: "get", bank, id });
        return { ...listResponse.items[0], bank_id: bank, content: "remembered architecture" };
      },
    });
    const ui = ctx(["Project", "Project model (model-1) tags=project", "View read-only summary"]);

    await handleMentalModels(ui.ctx as never, deps(client));

    expect(calls).toEqual([
      { method: "list", bank: "project-bank" },
      { method: "get", bank: "project-bank", id: "model-1" },
    ]);
    expect(ui.notifications[0]?.message).toContain("remembered architecture");
    expect(ui.notifications[0]?.message).toContain("read-only");
  });

  it("shows web interface hint without exposing create actions", async () => {
    const client = clientWith({
      listMentalModels: async () => listResponse,
    });
    const ui = ctx(["Project", "Project model (model-1) tags=project", "Web interface hint"]);

    await handleMentalModels(ui.ctx as never, deps(client));

    expect(ui.notifications[0]?.message).toContain("read-only");
    expect(ui.notifications[0]?.message).toContain("http://localhost:8888");
  });

  it("shows history without exposing refresh or delete actions", async () => {
    const calls: Array<{ method: string; bank: string; id?: string }> = [];
    const config = {
      ...DEFAULT_CONFIG,
      banks: {
        ...DEFAULT_CONFIG.banks,
        global: { ...DEFAULT_CONFIG.banks.global, enabled: true, bankId: "global-bank" },
      },
    };
    const client = clientWith({
      listMentalModels: async (bank) => {
        calls.push({ method: "list", bank });
        return listResponse;
      },
      getMentalModelHistory: async (bank, id) => {
        calls.push({ method: "history", bank, id });
        return { items: [{ id: "v1", created_at: "2026-05-04T01:00:00Z" }] };
      },
    });

    const ui = ctx(["Global", "Project model (model-1) tags=project", "History summary"]);
    await handleMentalModels(ui.ctx as never, deps(client, config));

    expect(calls).toEqual([
      { method: "list", bank: "global-bank" },
      { method: "history", bank: "global-bank", id: "model-1" },
    ]);
    expect(ui.notifications[0]?.message).toContain("Mental model history");
    expect(ui.notifications[0]?.message).toContain("read-only");
  });
});
