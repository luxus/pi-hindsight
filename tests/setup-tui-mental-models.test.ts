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
    const ui = ctx(["Project", "Browse existing", "Project model (model-1) tags=project", "View"]);

    await handleMentalModels(ui.ctx as never, deps(client));

    expect(calls).toEqual([
      { method: "list", bank: "project-bank" },
      { method: "get", bank: "project-bank", id: "model-1" },
    ]);
    expect(ui.notifications[0]?.message).toContain("remembered architecture");
  });

  it("creates a mental model from a reflect query with preview", async () => {
    const calls: Array<{ method: string; bank: string; request: unknown }> = [];
    const client = clientWith({
      createMentalModel: async (bank, request) => {
        calls.push({ method: "create", bank, request });
        return { operation_id: "op-create", status: "queued" };
      },
    });
    const ui = ctx(
      ["Project", "Create from reflect query", "Create"],
      ["Project patterns", "What project patterns recur?", "project, patterns"],
    );

    await handleMentalModels(ui.ctx as never, deps(client));

    expect(calls).toEqual([
      {
        method: "create",
        bank: "project-bank",
        request: {
          name: "Project patterns",
          sourceQuery: "What project patterns recur?",
          tags: ["project", "patterns"],
        },
      },
    ]);
    expect(ui.notifications[0]?.message).toContain("op-create");
  });

  it("refreshes, shows history, and requires typed exact id for delete", async () => {
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
      refreshMentalModel: async (bank, id) => {
        calls.push({ method: "refresh", bank, id });
        return { operation_id: "op-1", status: "queued" };
      },
      getMentalModelHistory: async (bank, id) => {
        calls.push({ method: "history", bank, id });
        return { items: [{ id: "v1", created_at: "2026-05-04T01:00:00Z" }] };
      },
      deleteMentalModel: async (bank, id) => {
        calls.push({ method: "delete", bank, id });
        return {};
      },
    });

    await handleMentalModels(
      ctx(["Global", "Browse existing", "Project model (model-1) tags=project", "Refresh"])
        .ctx as never,
      deps(client, config),
    );
    await handleMentalModels(
      ctx(["Global", "Browse existing", "Project model (model-1) tags=project", "History"])
        .ctx as never,
      deps(client, config),
    );
    const wrongDelete = ctx(
      ["Global", "Browse existing", "Project model (model-1) tags=project", "Delete"],
      ["wrong"],
    );
    await handleMentalModels(wrongDelete.ctx as never, deps(client, config));
    const exactDelete = ctx(
      ["Global", "Browse existing", "Project model (model-1) tags=project", "Delete"],
      ["model-1"],
    );
    await handleMentalModels(exactDelete.ctx as never, deps(client, config));

    expect(exactDelete.prompts[0]?.fallback).toBe("");
    expect(calls).toContainEqual({ method: "refresh", bank: "global-bank", id: "model-1" });
    expect(calls).toContainEqual({ method: "history", bank: "global-bank", id: "model-1" });
    expect(calls.filter((call) => call.method === "delete")).toEqual([
      { method: "delete", bank: "global-bank", id: "model-1" },
    ]);
    expect(wrongDelete.notifications[0]?.message).toContain("exact ID did not match");
  });
});
