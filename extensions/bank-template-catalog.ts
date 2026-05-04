export type BankTemplateProfileId = "coding-project" | "assistant-personal" | "general-user";

export type BankTemplateTarget = "project" | "user";

export interface BankTemplateManifest {
  version: "1";
  bank?: Record<string, unknown>;
  mental_models?: BankTemplateMentalModel[];
  directives?: BankTemplateDirective[];
}

export interface BankTemplateMentalModel {
  id: string;
  name: string;
  source_query: string;
  tags?: string[];
  max_tokens?: number;
  trigger?: Record<string, unknown>;
}

export interface BankTemplateDirective {
  name: string;
  content: string;
  priority?: number;
  is_active?: boolean;
  tags?: string[];
}

export interface BuiltInBankTemplate {
  id: BankTemplateProfileId;
  label: string;
  target: BankTemplateTarget;
  description: string;
  importProfile: "coding" | "assistant" | "general";
  manifest: BankTemplateManifest;
}

const refreshTrigger = { refresh_after_consolidation: true, mode: "full" } as const;

export const BUILT_IN_BANK_TEMPLATES: readonly BuiltInBankTemplate[] = [
  {
    id: "coding-project",
    label: "Coding / Project",
    target: "project",
    importProfile: "coding",
    description:
      "Repo-focused memory for architecture, decisions, conventions, and recurring issues.",
    manifest: {
      version: "1",
      bank: {
        retain_mission:
          "Extract technical decisions and their rationale, architectural choices, coding patterns and conventions, project structure facts, library/tool preferences, and recurring issues. Ignore transient debugging output and boilerplate.",
        reflect_mission:
          "You are a senior coding assistant using project memory. Ground answers in documented architecture, decisions, conventions, recurring issues, and developer workflow preferences. Prefer precise, actionable engineering context over speculation.",
        enable_observations: true,
        observations_mission:
          "Track stable project facts: tech stack, team conventions, architecture patterns, and how the codebase evolves over time.",
      },
      mental_models: [
        {
          id: "project-context",
          name: "Project Context",
          source_query:
            "What is the project's tech stack, architecture, and key conventions? What are the main components and how do they fit together?",
          max_tokens: 2048,
          trigger: refreshTrigger,
        },
        {
          id: "developer-preferences",
          name: "Developer Preferences",
          source_query:
            "What are the developer's preferences for tools, libraries, coding style, and workflow? How do they like code to be written and reviewed?",
          max_tokens: 1024,
          trigger: refreshTrigger,
        },
      ],
    },
  },
  {
    id: "assistant-personal",
    label: "Assistant / Personal",
    target: "user",
    importProfile: "assistant",
    description:
      "Personal assistant memory for routines, commitments, people, and recurring needs.",
    manifest: {
      version: "1",
      bank: {
        retain_mission:
          "Extract the user's preferences, routines, scheduled events, commitments, people they mention, and any personal context they share. Track what they ask for repeatedly and what they care about.",
        reflect_mission:
          "You are a personal assistant using user memory. Ground help in the user's stable preferences, routines, commitments, relationships, and recurring needs. Be careful with privacy and distinguish durable facts from transient chat.",
        enable_observations: true,
        observations_mission:
          "Track the user's stable preferences, recurring routines, important people and relationships, and how their priorities shift over time.",
      },
      mental_models: [
        {
          id: "user-profile",
          name: "User Profile",
          source_query:
            "What do we know about this user? What are their preferences, routines, important people, and how do they like to be helped?",
          max_tokens: 2048,
          trigger: refreshTrigger,
        },
        {
          id: "active-tasks",
          name: "Active Tasks & Commitments",
          source_query:
            "What tasks, commitments, or follow-ups is the user currently tracking? What deadlines or promises have been made?",
          max_tokens: 1024,
          trigger: refreshTrigger,
        },
      ],
    },
  },
  {
    id: "general-user",
    label: "General Conversation / User",
    target: "user",
    importProfile: "general",
    description:
      "General user memory for preferences, stated facts, recurring topics, and open threads.",
    manifest: {
      version: "1",
      bank: {
        retain_mission:
          "Extract user preferences, stated facts about themselves, requests they've made, topics they care about, and any commitments or follow-ups. Ignore small talk and filler.",
        reflect_mission:
          "You are an assistant using user conversation memory. Ground answers in the user's stated preferences, background, communication style, recurring topics, commitments, and open follow-ups. Avoid over-interpreting small talk.",
        enable_observations: true,
        observations_mission:
          "Track stable user preferences, communication style, recurring topics, and how the user's needs evolve over time.",
      },
      mental_models: [
        {
          id: "user-profile",
          name: "User Profile",
          source_query:
            "What do we know about this user? What are their preferences, background, and how do they like to interact?",
          max_tokens: 2048,
          trigger: refreshTrigger,
        },
        {
          id: "open-threads",
          name: "Open Threads",
          source_query:
            "What topics, tasks, or follow-ups are still open or unresolved from past conversations?",
          max_tokens: 1024,
          trigger: refreshTrigger,
        },
      ],
    },
  },
] as const;

export function getBuiltInBankTemplate(id: BankTemplateProfileId): BuiltInBankTemplate {
  const template = BUILT_IN_BANK_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown built-in bank template: ${id}`);
  return template;
}

export function defaultBankTemplateForTarget(target: BankTemplateTarget): BuiltInBankTemplate {
  return getBuiltInBankTemplate(target === "project" ? "coding-project" : "general-user");
}

export function isBankTemplateProfileId(value: string): value is BankTemplateProfileId {
  return BUILT_IN_BANK_TEMPLATES.some((template) => template.id === value);
}

export function cloneBankTemplateManifest(manifest: BankTemplateManifest): BankTemplateManifest {
  return JSON.parse(JSON.stringify(manifest)) as BankTemplateManifest;
}

export function summarizeBankTemplateManifest(manifest: BankTemplateManifest): {
  version: string;
  bankOverrideCount: number;
  mentalModelCount: number;
  directiveCount: number;
} {
  return {
    version: manifest.version,
    bankOverrideCount: manifest.bank ? Object.keys(manifest.bank).length : 0,
    mentalModelCount: manifest.mental_models?.length ?? 0,
    directiveCount: manifest.directives?.length ?? 0,
  };
}
