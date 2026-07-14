import type {
  BankTemplateConfig,
  BankTemplateManifest,
  BankTemplateMentalModel,
} from "@vectorize-io/hindsight-client";
import {
  defaultGlobalBankMissions,
  defaultLifeBankMissions,
  defaultProjectBankMissions,
  resolveBankMissions,
} from "./bank-operations.js";
import type { BankMissionDefaults } from "./bank-operations.js";
import type { AgentUseProfile, BankMissionSettings } from "../types.js";

export type BankTemplateProfileId =
  | "pi-coding-project"
  | "pi-conversation-project"
  | "pi-coding-user"
  | "pi-conversation-user"
  /** @deprecated alias for pi-coding-user */
  | "pi-user-preferences";

export type BankTemplateTarget = "project" | "user";

export interface BuiltInBankTemplate {
  id: BankTemplateProfileId;
  label: string;
  target: BankTemplateTarget;
  /** Which agent use profile this template is for. */
  agentUse: AgentUseProfile;
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

// Tags must be a subset of tags written at retain time (source:pi, project:*, session:*, repo:*).
// Project-tier models get project:<id> stamped at apply time (resolveBankTemplateManifest).
const RETAIN_COMPAT_TAGS = ["source:pi"] as const;

/**
 * Coding-agent MM refresh defaults (oh-my-pi / Claude Code / Hindsight deep dive):
 * delta folds new evidence; refresh after consolidation; no MM→MM feedback.
 * Project MMs: observation-first (less probe/world noise).
 * Prefs/user MMs: world+experience+observation — observation-only can rebuild empty after clear
 * (live: coding-assistant-operating-preferences → "#").
 * Template import sends the full trigger; agent create only maps refreshAfterConsolidation today.
 */
type MmTrigger = NonNullable<BankTemplateMentalModel["trigger"]>;
const DEFAULT_MM_TRIGGER_PROJECT: MmTrigger = {
  mode: "delta",
  refresh_after_consolidation: true,
  fact_types: ["observation"],
  exclude_mental_models: true,
};
const DEFAULT_MM_TRIGGER_PREFS: MmTrigger = {
  mode: "delta",
  refresh_after_consolidation: true,
  fact_types: ["world", "experience", "observation"],
  exclude_mental_models: true,
};

/** Seed max_tokens: keep inject lean (AMB cost; inject shares mentalModels.maxChars). */
const DEFAULT_MM_MAX_TOKENS_PREFS = 600;
const DEFAULT_MM_MAX_TOKENS_PROJECT = 800;

// Bank-global on shared coding bank (no project:* tag) — injects for every project.
const CODING_BANK_GLOBAL_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "coding-assistant-operating-preferences",
    name: "Coding assistant operating preferences",
    source_query:
      "What durable preferences has the user shown for how coding assistants should plan, verify, commit, use tools, and communicate across repositories? Especially capture clarification style: whether questions are welcome, when to ask (up front vs mid-task), and that questions should be high-signal (not answerable by the agent alone). Exclude one-off probe/bait/test session constraints such as temporary 'do not ask questions; just execute' rules. Capture only stable cross-project habits.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
];

// Coding project models — durable engineering knowledge (oh-my-pi-shaped core + a few extras).
const CODING_PROJECT_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "project-architecture-and-seams",
    name: "Project architecture and seams",
    source_query:
      "What are the stable architecture boundaries, modules, and seams in this project?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PROJECT,
    trigger: DEFAULT_MM_TRIGGER_PROJECT,
  },
  {
    id: "project-conventions",
    name: "Project conventions",
    source_query:
      "What are this project's conventions for code style, build, testing, release, and review? Only include conventions explicit in the project or repeatedly enforced.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PROJECT,
    trigger: DEFAULT_MM_TRIGGER_PROJECT,
  },
  {
    id: "project-decisions",
    name: "Project decisions",
    source_query:
      "What durable architectural or product decisions have been made for this project, and what rationale or trade-offs were recorded? Exclude transient plans and active task state.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PROJECT,
    trigger: DEFAULT_MM_TRIGGER_PROJECT,
  },
];

// Conversation / real-life task project models — not coding-centric.
const CONVERSATION_PROJECT_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "active-goals-and-commitments",
    name: "Active goals and commitments",
    source_query:
      "What goals, commitments, deadlines, and open loops is the user tracking in this context? Prefer durable ongoing items over one-off chat filler.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PROJECT,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "people-and-context",
    name: "People and context",
    source_query:
      "Which people, roles, relationships, and recurring situations matter here? Capture only durable context the assistant needs, not sensitive private details.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "decisions-and-preferences",
    name: "Decisions and preferences",
    source_query:
      "What durable decisions, preferences, and constraints has the user stated for this conversation or life domain? Exclude one-off requests.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PROJECT,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
];

const CODING_USER_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "user-collaboration-preferences",
    name: "User collaboration preferences",
    source_query:
      "What durable preferences has the user shown for collaboration, review, autonomy, and communication?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "coding-assistant-operating-preferences",
    name: "Coding assistant operating preferences",
    source_query:
      "What durable preferences has the user shown for how coding assistants should plan, verify, commit, and use tools?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "cross-project-workflow-habits",
    name: "Cross-project workflow habits",
    source_query:
      "What workflow habits recur across the user's repositories, issue tracking, PR review, and release process?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
];

const CONVERSATION_USER_MENTAL_MODELS: BankTemplateMentalModel[] = [
  {
    id: "communication-preferences",
    name: "Communication preferences",
    source_query:
      "What durable preferences has the user shown for tone, length, language, and how the assistant should respond?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "life-workflow-habits",
    name: "Life and task workflow habits",
    source_query:
      "What recurring real-life workflows, planning habits, and task-management preferences does the user express across conversations?",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
  {
    id: "priority-and-scheduling-preferences",
    name: "Priority and scheduling preferences",
    source_query:
      "How does the user prefer to prioritize, schedule, and trade off time across personal and work tasks? Capture durable patterns only.",
    tags: [...RETAIN_COMPAT_TAGS],
    max_tokens: DEFAULT_MM_MAX_TOKENS_PREFS,
    trigger: DEFAULT_MM_TRIGGER_PREFS,
  },
];

export const BUILT_IN_BANK_TEMPLATES: readonly BuiltInBankTemplate[] = [
  {
    id: "pi-coding-project",
    label: "Coding project",
    target: "project",
    agentUse: "coding",
    description: "Repo-focused mental models for architecture, conventions, and durable decisions.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultProjectBankMissions()),
      mental_models: CODING_PROJECT_MENTAL_MODELS,
    },
  },
  {
    id: "pi-conversation-project",
    label: "Conversation / life tasks",
    target: "project",
    agentUse: "conversation",
    description:
      "Non-coding mental models for goals, people/context, and durable decisions in a conversation or real-life task agent.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultProjectBankMissions()),
      mental_models: CONVERSATION_PROJECT_MENTAL_MODELS,
    },
  },
  {
    id: "pi-coding-user",
    label: "Coding user preferences",
    target: "user",
    agentUse: "coding",
    description: "Cross-project durable coding-assistant and collaboration preferences.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultGlobalBankMissions()),
      mental_models: CODING_USER_MENTAL_MODELS,
    },
  },
  {
    id: "pi-conversation-user",
    label: "Conversation user preferences",
    target: "user",
    agentUse: "conversation",
    description: "Cross-context durable communication and life-workflow preferences.",
    manifest: {
      version: "1",
      bank: bankConfigFromMissions(defaultLifeBankMissions()),
      mental_models: CONVERSATION_USER_MENTAL_MODELS,
    },
  },
] as const;

/** Legacy id still resolves for older docs/scripts. */
const LEGACY_TEMPLATE_ALIASES: Record<string, BankTemplateProfileId> = {
  "pi-user-preferences": "pi-coding-user",
};

export function listBuiltInBankTemplates(): readonly BuiltInBankTemplate[] {
  return BUILT_IN_BANK_TEMPLATES;
}

export function listBankTemplatesForAgentUse(
  agentUse: AgentUseProfile,
): readonly BuiltInBankTemplate[] {
  return BUILT_IN_BANK_TEMPLATES.filter((template) => template.agentUse === agentUse);
}

export function defaultTemplateIdFor(
  target: BankTemplateTarget,
  agentUse: AgentUseProfile,
): BankTemplateProfileId {
  if (target === "project") {
    return agentUse === "conversation" ? "pi-conversation-project" : "pi-coding-project";
  }
  return agentUse === "conversation" ? "pi-conversation-user" : "pi-coding-user";
}

export function getBuiltInBankTemplate(id: string): BuiltInBankTemplate | undefined {
  const resolved = LEGACY_TEMPLATE_ALIASES[id] ?? id;
  return BUILT_IN_BANK_TEMPLATES.find((template) => template.id === resolved);
}

function defaultMissionsForTarget(
  target: BankTemplateTarget,
  agentUse: AgentUseProfile,
): BankMissionDefaults {
  if (target === "user") {
    return agentUse === "conversation" ? defaultLifeBankMissions() : defaultGlobalBankMissions();
  }
  return defaultProjectBankMissions();
}

function slugProjectId(projectId: string): string {
  return (
    projectId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "project"
  );
}

/** Bank-global models merged into coding project template apply (unstamped). */
function bankGlobalMentalModelsForTemplate(templateId: string): readonly BankTemplateMentalModel[] {
  if (templateId === "pi-coding-project") return CODING_BANK_GLOBAL_MENTAL_MODELS;
  return [];
}

/**
 * Resolve template manifest for import. For project-target templates with a projectId,
 * stamp project-tier mental models with project:<id> tags and id suffixes so multi-project
 * domain banks do not share one architecture model (ADR-005). Coding project templates also
 * merge bank-global models (no project tag) so setup can ensure cross-project starters.
 */
export function resolveBankTemplateManifest(
  template: BuiltInBankTemplate,
  bankMissionSettings: BankMissionSettings,
  options?: { projectId?: string },
): BankTemplateManifest {
  const missions = resolveBankMissions(
    bankMissionSettings,
    defaultMissionsForTarget(template.target, template.agentUse),
  );
  const projectId = options?.projectId?.trim();
  let mental_models = template.manifest.mental_models;
  if (template.target === "project" && projectId && mental_models?.length) {
    const suffix = slugProjectId(projectId);
    const projectTag = `project:${projectId}`;
    const stamped = mental_models.map((model) => ({
      ...model,
      id: `${model.id}--${suffix}`,
      tags: [...new Set([...(model.tags ?? []), "source:pi", projectTag])],
    }));
    const bankGlobal = bankGlobalMentalModelsForTemplate(template.id);
    mental_models = bankGlobal.length > 0 ? [...bankGlobal, ...stamped] : stamped;
  }
  return {
    ...template.manifest,
    ...(mental_models ? { mental_models } : {}),
    bank: bankConfigFromMissions(missions),
  };
}

/** Expected starter mental-model ids after resolve (for setup ensure checks). */
export function expectedStarterMentalModelIds(args: {
  target: BankTemplateTarget;
  agentUse: AgentUseProfile;
  projectId?: string;
  bankMissionSettings?: BankMissionSettings;
}): string[] {
  const template = getBuiltInBankTemplate(defaultTemplateIdFor(args.target, args.agentUse));
  if (!template) return [];
  const manifest = resolveBankTemplateManifest(template, args.bankMissionSettings ?? {}, {
    ...(args.projectId ? { projectId: args.projectId } : {}),
  });
  return (manifest.mental_models ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
