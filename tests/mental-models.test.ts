import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  listBankTemplatesForAgentUse,
  defaultTemplateIdFor,
  getBuiltInBankTemplate,
} from "../extensions/banks/bank-templates.js";
import {
  clearMentalModelListCache,
  loadMentalModelsForScopes,
  minMentalModelRenderBudgetChars,
  renderMentalModelsBlock,
  MENTAL_MODELS_OPEN,
} from "../extensions/lifecycle/mental-models.js";
import { recallForContext } from "../extensions/lifecycle/recall.js";
import { buildRetainJob } from "../extensions/lifecycle/retain.js";
import { isInjectedHindsightMemory } from "../extensions/utils/messages.js";
import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import type { HindsightLikeClient } from "../extensions/types.js";

describe("use-profile mental model sets", () => {
  it("returns distinct coding vs conversation project model sets", () => {
    const coding = listBankTemplatesForAgentUse("coding");
    const conversation = listBankTemplatesForAgentUse("conversation");
    const codingIds = coding.flatMap((t) => t.manifest.mental_models?.map((m) => m.id) ?? []);
    const conversationIds = conversation.flatMap(
      (t) => t.manifest.mental_models?.map((m) => m.id) ?? [],
    );

    expect(coding.map((t) => t.id).sort()).toEqual(["pi-coding-project", "pi-coding-user"]);
    expect(conversation.map((t) => t.id).sort()).toEqual([
      "pi-conversation-project",
      "pi-conversation-user",
    ]);
    expect(codingIds).toContain("project-architecture-and-seams");
    expect(codingIds).not.toContain("active-goals-and-commitments");
    expect(conversationIds).toContain("active-goals-and-commitments");
    expect(conversationIds).not.toContain("project-architecture-and-seams");
    expect(defaultTemplateIdFor("project", "coding")).toBe("pi-coding-project");
    expect(defaultTemplateIdFor("project", "conversation")).toBe("pi-conversation-project");
  });

  it("keeps legacy pi-user-preferences alias for coding user set", () => {
    expect(getBuiltInBankTemplate("pi-user-preferences")?.id).toBe("pi-coding-user");
  });

  it("uses retain-compatible source:pi tags on seed definitions", () => {
    for (const template of [
      ...listBankTemplatesForAgentUse("coding"),
      ...listBankTemplatesForAgentUse("conversation"),
    ]) {
      for (const model of template.manifest.mental_models ?? []) {
        expect(model.tags).toEqual(["source:pi"]);
      }
    }
  });

  it("stamps project tags and id suffixes when resolving project templates", async () => {
    const { resolveBankTemplateManifest } = await import("../extensions/banks/bank-templates.js");
    const template = getBuiltInBankTemplate("pi-coding-project");
    expect(template).toBeTruthy();
    const manifest = resolveBankTemplateManifest(template!, {}, { projectId: "finalform" });
    const models = manifest.mental_models ?? [];
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.id).toContain("--finalform");
      expect(model.tags).toEqual(expect.arrayContaining(["source:pi", "project:finalform"]));
    }
  });
});

describe("mental model inject filter", () => {
  it("keeps bank-global and matching project models only", async () => {
    const { filterMentalModelsForInject } =
      await import("../extensions/lifecycle/mental-models.js");
    const models = [
      { id: "g", name: "Global prefs", content: "prefs", tags: ["source:pi"] },
      {
        id: "a",
        name: "Arch A",
        content: "arch a",
        tags: ["source:pi", "project:alpha"],
      },
      {
        id: "b",
        name: "Arch B",
        content: "arch b",
        tags: ["source:pi", "project:beta"],
      },
    ];
    const filtered = filterMentalModelsForInject(models, {
      bankKind: "project",
      projectId: "alpha",
    });
    expect(filtered.map((m) => m.id).sort()).toEqual(["a", "g"]);
  });
});

describe("mental model injection and retain safety", () => {
  it("caches listMentalModels within cacheTtlMs", async () => {
    clearMentalModelListCache();
    const listMentalModels = vi.fn(async () => ({
      items: [{ id: "m1", name: "M1", content: "cached content" }],
    }));
    const client = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      listMentalModels,
    };
    const config = {
      ...DEFAULT_CONFIG,
      mentalModels: { inject: true, maxChars: 12_000, cacheTtlMs: 60_000 },
    };
    await loadMentalModelsForScopes({ client, config, bankIds: ["bank"] });
    await loadMentalModelsForScopes({ client, config, bankIds: ["bank"] });
    expect(listMentalModels).toHaveBeenCalledTimes(1);
  });

  it("renders a bounded mental-models block from model content", () => {
    clearMentalModelListCache();
    const rendered = renderMentalModelsBlock(
      [
        {
          id: "a",
          name: "Architecture",
          content: "Use modular seams between lifecycle and queue.",
        },
      ],
      12_000,
    );
    expect(rendered.startsWith(MENTAL_MODELS_OPEN)).toBe(true);
    expect(rendered).toContain("Architecture");
    expect(rendered).toContain("modular seams");
  });

  it("includes mental model content in automatic context when present", async () => {
    clearMentalModelListCache();
    const listMentalModels = vi.fn(async () => ({
      items: [
        {
          id: "project-decisions",
          name: "Project decisions",
          content: "Prefer append mode for live sessions.",
        },
      ],
    }));
    const client: HindsightLikeClient = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      listMentalModels,
    };

    const result = await recallForContext({
      client,
      config: DEFAULT_CONFIG,
      scopes: [{ bankId: "project-bank", kind: "project" }],
      messages: [{ role: "user", content: "What did we decide?", timestamp: 1 } as any],
      cwd: "/repo",
    });

    expect(listMentalModels).toHaveBeenCalledWith("project-bank");
    expect(result.rendered).toContain(MENTAL_MODELS_OPEN);
    expect(result.rendered).toContain("Prefer append mode for live sessions.");
  });

  it("skips mental model injection when inject is disabled", async () => {
    clearMentalModelListCache();
    const listMentalModels = vi.fn(async () => ({
      items: [{ id: "x", name: "X", content: "should not inject" }],
    }));
    const result = await loadMentalModelsForScopes({
      client: {
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        listMentalModels,
      },
      config: {
        ...DEFAULT_CONFIG,
        mentalModels: { ...DEFAULT_CONFIG.mentalModels, inject: false },
      },
      bankIds: ["bank"],
    });
    expect(result.rendered).toBe("");
    expect(listMentalModels).not.toHaveBeenCalled();
  });

  it("does not retain injected mental model blocks", () => {
    const messages = [
      { role: "user", content: "What should we keep?", timestamp: 1 },
      {
        role: "user",
        content: `${MENTAL_MODELS_OPEN}\nCurated models\n\n# Architecture\nKeep seams.\n</hindsight-mental-models>`,
        timestamp: 2,
      },
      { role: "assistant", content: "Keep durable decisions only.", timestamp: 3 },
    ] as unknown as AgentEndEvent["messages"];

    expect(
      isInjectedHindsightMemory({
        role: "user",
        content: `${MENTAL_MODELS_OPEN}\n…`,
      }),
    ).toBe(true);

    const job = buildRetainJob({
      config: DEFAULT_CONFIG,
      cwd: "/repo",
      sessionFile: "/tmp/session.jsonl",
      bankId: "project-bank",
      messages,
    });

    expect(job?.item.content).toContain("What should we keep?");
    expect(job?.item.content).toContain("Keep durable decisions only.");
    expect(job?.item.content).not.toContain(MENTAL_MODELS_OPEN);
    expect(job?.item.content).not.toContain("Keep seams.");
  });

  it("does not treat mid-message discussion of mental-model tags as injected", () => {
    expect(
      isInjectedHindsightMemory({
        role: "user",
        content: "Please do not put secrets inside <hindsight-mental-models> tags.",
      }),
    ).toBe(false);
    expect(
      isInjectedHindsightMemory({
        role: "user",
        content: "The docs mention <mental_models> as a wrapper.",
      }),
    ).toBe(false);
  });

  it("keeps multi-bank mental-model injection within maxChars total", async () => {
    clearMentalModelListCache();
    const minBudget = minMentalModelRenderBudgetChars();
    // Old equal-share code used max(minBudget, floor(max/n)) per bank, so two banks could inject
    // ~2*minBudget when maxChars is only 1.5*minBudget.
    const maxChars = Math.floor(minBudget * 1.5);
    const listMentalModels = vi.fn(async (bankId: string) => ({
      items: [
        {
          id: `${bankId}-model`,
          name: `${bankId} model`,
          content: "x".repeat(Math.max(800, minBudget)),
        },
      ],
    }));
    const result = await loadMentalModelsForScopes({
      client: {
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        listMentalModels,
      },
      config: {
        ...DEFAULT_CONFIG,
        mentalModels: { inject: true, maxChars, cacheTtlMs: 0 },
      },
      bankIds: ["project-bank", "user-bank"],
    });

    expect(result.rendered.length).toBeLessThanOrEqual(maxChars);
    expect(result.rendered.length).toBeLessThan(minBudget * 2);
  });
});
