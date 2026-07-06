import type {
  BankTemplateConfig,
  BankTemplateManifest,
  BankTemplateMentalModel,
} from "@vectorize-io/hindsight-client";
import {
  defaultGlobalBankMissions,
  defaultProjectBankMissions,
  resolveBankMissions,
} from "./bank-operations.js";
import type { BankMissionDefaults } from "./bank-operations.js";
import type { BankMissionSettings } from "../types.js";

export type BankTemplateProfileId = "pi-coding-project" | "pi-user-preferences";
export type BankTemplateTarget = "project" | "user";

export interface BuiltInBankTemplate {
  id: BankTemplateProfileId;
  label: string;
  target: BankTemplateTarget;
  description: string;
  manifest: BankTemplateManifest;
}

function bankConfigFromMissions(missions: BankMissionDefaults): BankTemplateConfig {
  return {
    reflect_mission: missions.reflectMission,
    retain_mission: missions.retainMission,
    enable_observations: true,
    observations_mission: missions.observationsMission,
  };
}

// Mirrors docs/starter-mental-model-suggestions.md's project-bank suggestions. Keep in sync;
// that doc is the source of truth for what these mental models ask and why. No refresh
// trigger is set: refresh stays explicit per that doc's product rules.
const PROJECT_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "project-architecture-and-seams",
    name: "Project architecture and seams",
    source_query:
      "What are the stable architecture boundaries, modules, and seams in this project?",
    tags: ["project", "architecture", "stable"],
    max_tokens: 2048,
  },
  {
    id: "testing-and-release-process",
    name: "Testing and release process",
    source_query: "What test, CI, release, and verification practices does this project use?",
    tags: ["project", "workflow", "release"],
    max_tokens: 2048,
  },
  {
    id: "memory-safety-policy",
    name: "Memory safety policy",
    source_query:
      "What memory rules, safety constraints, and anti-patterns matter in this project?",
    tags: ["project", "memory-policy", "safety"],
    max_tokens: 2048,
  },
  {
    id: "current-roadmap-and-priorities",
    name: "Current roadmap and priorities",
    source_query:
      "What roadmap themes, active priorities, and deferred non-goals recur for this project?",
    tags: ["project", "roadmap", "priority"],
    max_tokens: 2048,
  },
  {
    id: "code-style-and-naming-conventions",
    name: "Code style and naming conventions",
    source_query: "What code style, naming, module, and testing conventions recur in this project?",
    tags: ["project", "conventions", "style"],
    max_tokens: 2048,
  },
];

// Mirrors docs/starter-mental-model-suggestions.md's global-bank suggestions. Keep in sync.
const USER_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "user-collaboration-preferences",
    name: "User collaboration preferences",
    source_query:
      "What durable preferences has the user shown for collaboration, review, autonomy, and communication?",
    tags: ["global", "user-preference", "collaboration"],
    max_tokens: 2048,
  },
  {
    id: "coding-assistant-operating-preferences",
    name: "Coding assistant operating preferences",
    source_query:
      "What durable preferences has the user shown for how coding assistants should plan, verify, commit, and use tools?",
    tags: ["global", "assistant-workflow", "preference"],
    max_tokens: 2048,
  },
  {
    id: "cross-project-workflow-habits",
    name: "Cross-project workflow habits",
    source_query:
      "What workflow habits recur across the user's repositories, issue tracking, PR review, and release process?",
    tags: ["global", "workflow", "cross-project"],
    max_tokens: 2048,
  },
  {
    id: "tooling-and-review-preferences",
    name: "Tooling and review preferences",
    source_query:
      "What tools, checks, review loops, and quality gates does the user repeatedly prefer?",
    tags: ["global", "tooling", "review"],
    max_tokens: 2048,
  },
];

export const BUILT_IN_BANK_TEMPLATES: readonly BuiltInBankTemplate[] = [
  {
    id: "pi-coding-project",
    label: "Pi Coding Project",
    target: "project",
    description:
      "Repo-focused memory for architecture, decisions, conventions, and recurring issues. Bank config falls back to Pi Hindsight's default project-bank missions, keeping any mission you've already customized; adds starter mental models from docs/starter-mental-model-suggestions.md.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultProjectBankMissions()),
      mental_models: PROJECT_MENTAL_MODELS,
    },
  },
  {
    id: "pi-user-preferences",
    label: "Pi User Preferences",
    target: "user",
    description:
      "Cross-project durable preferences, workflow habits, and assistant behavior guidance. Bank config falls back to Pi Hindsight's default user-bank missions, keeping any mission you've already customized; adds starter mental models from docs/starter-mental-model-suggestions.md.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultGlobalBankMissions()),
      mental_models: USER_MENTAL_MODELS,
    },
  },
] as const;

export function listBuiltInBankTemplates(): readonly BuiltInBankTemplate[] {
  return BUILT_IN_BANK_TEMPLATES;
}

export function getBuiltInBankTemplate(id: string): BuiltInBankTemplate | undefined {
  return BUILT_IN_BANK_TEMPLATES.find((template) => template.id === id);
}

function defaultMissionsForTarget(target: BankTemplateTarget): BankMissionDefaults {
  return target === "user" ? defaultGlobalBankMissions() : defaultProjectBankMissions();
}

// Resolves the manifest actually sent for a template against the caller's current bank
// mission settings, so applying a bundled template never clobbers a mission the user already
// customized away from Pi's defaults -- the same fallback ensureProjectBank/ensureGlobalBank
// use for bank creation. Falls back to the template's own default-based manifest.bank when the
// caller hasn't customized anything.
export function resolveBankTemplateManifest(
  template: BuiltInBankTemplate,
  bankMissionSettings: BankMissionSettings,
): BankTemplateManifest {
  const missions = resolveBankMissions(
    bankMissionSettings,
    defaultMissionsForTarget(template.target),
  );
  return {
    ...template.manifest,
    bank: bankConfigFromMissions(missions),
  };
}
