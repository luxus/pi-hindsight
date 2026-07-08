import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import {
  listBankTemplatesForAgentUse,
  defaultTemplateIdFor,
  getBuiltInBankTemplate,
} from "../extensions/banks/bank-templates.js";
import {
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

  it("uses retain-compatible source:pi tags on seeds", () => {
    for (const template of [
      ...listBankTemplatesForAgentUse("coding"),
      ...listBankTemplatesForAgentUse("conversation"),
    ]) {
      for (const model of template.manifest.mental_models ?? []) {
        expect(model.tags).toEqual(["source:pi"]);
      }
    }
  });
});

describe("mental model injection and retain safety", () => {
  it("renders a bounded mental-models block from model content", () => {
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
        mentalModels: { inject: true, maxChars },
      },
      bankIds: ["project-bank", "user-bank"],
    });

    expect(result.rendered.length).toBeLessThanOrEqual(maxChars);
    expect(result.rendered.length).toBeLessThan(minBudget * 2);
  });
});
