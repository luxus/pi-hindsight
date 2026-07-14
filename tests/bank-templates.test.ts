import { describe, expect, it } from "vitest";
import {
  defaultGlobalBankMissions,
  defaultProjectBankMissions,
} from "../extensions/banks/bank-operations.js";
import {
  BUILT_IN_BANK_TEMPLATES,
  expectedStarterMentalModelIds,
  getBuiltInBankTemplate,
  listBuiltInBankTemplates,
  resolveBankTemplateManifest,
} from "../extensions/banks/bank-templates.js";

describe("bank templates", () => {
  it("has unique lowercase-hyphenated ids for every built-in template", () => {
    const ids = BUILT_IN_BANK_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("declares a valid version-1 manifest with unique mental model ids for every template", () => {
    for (const template of BUILT_IN_BANK_TEMPLATES) {
      expect(template.manifest.version).toBe("1");
      const mentalModelIds = template.manifest.mental_models?.map((model) => model.id) ?? [];
      expect(mentalModelIds.length).toBeGreaterThan(0);
      expect(new Set(mentalModelIds).size).toBe(mentalModelIds.length);
      for (const id of mentalModelIds) expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("matches Pi's own default project-bank missions for the project template", () => {
    const template = getBuiltInBankTemplate("pi-coding-project");
    const defaults = defaultProjectBankMissions();

    expect(template?.target).toBe("project");
    expect(template?.manifest.bank).toMatchObject({
      reflect_mission: defaults.reflectMission,
      retain_mission: defaults.retainMission,
      observations_mission: defaults.observationsMission,
      enable_observations: true,
    });
  });

  it("matches Pi's own default user-bank missions for the coding user template", () => {
    const template = getBuiltInBankTemplate("pi-coding-user");
    const defaults = defaultGlobalBankMissions();

    expect(template?.target).toBe("user");
    expect(template?.agentUse).toBe("coding");
    expect(template?.manifest.bank).toMatchObject({
      reflect_mission: defaults.reflectMission,
      retain_mission: defaults.retainMission,
      observations_mission: defaults.observationsMission,
      enable_observations: true,
    });
  });

  it("uses life bank missions for the conversation user template", async () => {
    const { defaultLifeBankMissions } = await import("../extensions/banks/bank-operations.js");
    const template = getBuiltInBankTemplate("pi-conversation-user");
    const defaults = defaultLifeBankMissions();

    expect(template?.target).toBe("user");
    expect(template?.agentUse).toBe("conversation");
    expect(template?.manifest.bank).toMatchObject({
      reflect_mission: defaults.reflectMission,
      retain_mission: defaults.retainMission,
      observations_mission: defaults.observationsMission,
    });
  });

  it("includes a conversation project template distinct from coding", () => {
    const coding = getBuiltInBankTemplate("pi-coding-project");
    const conversation = getBuiltInBankTemplate("pi-conversation-project");
    expect(conversation?.agentUse).toBe("conversation");
    expect(conversation?.manifest.mental_models?.map((m) => m.id)).not.toEqual(
      coding?.manifest.mental_models?.map((m) => m.id),
    );
  });

  it("uses delta refresh defaults on bundled mental models", () => {
    for (const template of BUILT_IN_BANK_TEMPLATES) {
      for (const model of template.manifest.mental_models ?? []) {
        expect(model.trigger).toMatchObject({
          mode: "delta",
          refresh_after_consolidation: true,
          fact_types: ["observation"],
          exclude_mental_models: true,
        });
        expect(model.max_tokens).toBeLessThanOrEqual(800);
      }
    }
  });

  it("returns undefined for an unknown template id", () => {
    expect(getBuiltInBankTemplate("does-not-exist")).toBeUndefined();
  });

  it("resolves default missions when the caller has not customized any bank mission", () => {
    const template = getBuiltInBankTemplate("pi-coding-project")!;
    const defaults = defaultProjectBankMissions();

    const manifest = resolveBankTemplateManifest(template, {});

    expect(manifest.bank).toMatchObject({
      reflect_mission: defaults.reflectMission,
      retain_mission: defaults.retainMission,
      observations_mission: defaults.observationsMission,
    });
  });

  it("keeps the caller's customized mission instead of the template default", () => {
    const template = getBuiltInBankTemplate("pi-coding-project")!;
    const defaults = defaultProjectBankMissions();

    const manifest = resolveBankTemplateManifest(template, { retainMission: "Custom retain" });

    expect(manifest.bank?.retain_mission).toBe("Custom retain");
    expect(manifest.bank?.reflect_mission).toBe(defaults.reflectMission);
  });

  it("does not mutate the template's own mental models when resolving a customized manifest", () => {
    const template = getBuiltInBankTemplate("pi-coding-project")!;

    const manifest = resolveBankTemplateManifest(template, { retainMission: "Custom retain" });

    expect(manifest.mental_models).toBe(template.manifest.mental_models);
  });

  it("stamps project models and merges bank-global starters for coding project resolve", () => {
    const template = getBuiltInBankTemplate("pi-coding-project")!;
    const manifest = resolveBankTemplateManifest(
      template,
      {},
      {
        projectId: "github-com-luxus-pi-hindsight",
      },
    );
    const ids = manifest.mental_models?.map((model) => model.id) ?? [];
    expect(ids).toContain("coding-assistant-operating-preferences");
    expect(ids).toContain("project-architecture-and-seams--github-com-luxus-pi-hindsight");
    expect(ids).toContain("project-conventions--github-com-luxus-pi-hindsight");
    expect(ids).toContain("project-decisions--github-com-luxus-pi-hindsight");
    const global = manifest.mental_models?.find(
      (model) => model.id === "coding-assistant-operating-preferences",
    );
    expect(global?.tags).toEqual(["source:pi"]);
    const project = manifest.mental_models?.find(
      (model) => model.id === "project-decisions--github-com-luxus-pi-hindsight",
    );
    expect(project?.tags).toEqual(
      expect.arrayContaining(["source:pi", "project:github-com-luxus-pi-hindsight"]),
    );
  });

  it("lists expected starter ids for setup ensure checks", () => {
    const ids = expectedStarterMentalModelIds({
      target: "project",
      agentUse: "coding",
      projectId: "github-com-luxus-pi-hindsight",
    });
    expect(ids).toEqual([
      "coding-assistant-operating-preferences",
      "project-architecture-and-seams--github-com-luxus-pi-hindsight",
      "project-conventions--github-com-luxus-pi-hindsight",
      "project-decisions--github-com-luxus-pi-hindsight",
    ]);
  });

  it("lists all built-in templates", () => {
    expect(listBuiltInBankTemplates()).toHaveLength(BUILT_IN_BANK_TEMPLATES.length);
  });
});
