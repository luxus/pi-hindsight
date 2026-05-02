import type { ResolvedConfig } from "./types.js";

export type MemoryRoute = "project" | "global" | "both" | "skip";
export type MemoryRouteSignal = "global" | "project" | "skip";

export interface MemoryRouteInput {
  content: string;
  context?: string;
  config: ResolvedConfig;
}

export interface MemoryRouteClassification {
  route: MemoryRoute;
  confidence: number;
  signals: MemoryRouteSignal[];
  matchedSignals: string[];
}

export interface MemoryRouterAdapter {
  classify(args: {
    content: string;
    context?: string;
    projectMission?: string;
    globalMission?: string;
  }): MemoryRouteClassification;
}

export interface MemoryRouteDecision extends MemoryRouteClassification {
  reason: string;
  mode: ResolvedConfig["globalRetain"]["mode"];
  writes: string[];
  projectMission: string;
  globalMission: string;
}

const GLOBAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(prefer|prefers|preference|likes|wants|always|never)\b/i, "preference"],
  [/\b(name|nick|nickname|identity|male|female|pronouns?)\b/i, "identity"],
  [
    /\b(workflow|habit|communication style|response style|across projects|global)\b/i,
    "cross-project workflow/style",
  ],
];

const PROJECT_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(repo|project|file|path|module|test|bug|fix|architecture|config|implementation)\b/i,
    "project implementation",
  ],
  [/\b(PR|issue|commit|branch|importer|extension|TUI|API)\b/, "project delivery"],
];

const SKIP_PATTERNS: Array<[RegExp, string]> = [
  [/\/var\/folders\//i, "temporary file path"],
  [/\btemporary\b/i, "temporary detail"],
  [/\bscreenshot\b/i, "screenshot artifact"],
];

function matchSignals(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.flatMap(([pattern, label]) => (pattern.test(text) ? [label] : []));
}

function classifyFromSignals(args: {
  globalMatches: string[];
  projectMatches: string[];
  skipMatches: string[];
}): MemoryRouteClassification {
  const skip = args.skipMatches.length > 0;
  const global = args.globalMatches.length > 0;
  const project = args.projectMatches.length > 0;
  const route: MemoryRoute = skip
    ? "skip"
    : global && project
      ? "both"
      : global
        ? "global"
        : project
          ? "project"
          : "skip";
  const confidence = skip
    ? 0.9
    : global && !project
      ? 0.85
      : project && !global
        ? 0.8
        : global && project
          ? 0.65
          : 0.4;
  const signals: MemoryRouteSignal[] = [
    ...(skip ? (["skip"] as const) : []),
    ...(global ? (["global"] as const) : []),
    ...(project ? (["project"] as const) : []),
  ];
  return {
    route,
    confidence,
    signals,
    matchedSignals: [...args.skipMatches, ...args.globalMatches, ...args.projectMatches],
  };
}

function missionTerms(mission: string | undefined): string[] {
  return (mission ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (term) =>
        term.length >= 5 &&
        !["built", "global", "memory", "mission", "project", "retain", "reflect"].includes(term),
    );
}

function missionMatches(text: string, mission: string | undefined, label: string): string[] {
  const lower = text.toLowerCase();
  const matched = missionTerms(mission).filter((term) => lower.includes(term));
  return matched.length ? [`${label} mission:${matched.slice(0, 3).join("/")}`] : [];
}

export function createMissionAwareMemoryRouter(): MemoryRouterAdapter {
  return {
    classify(args) {
      const text = `${args.content}\n${args.context ?? ""}`;
      return classifyFromSignals({
        globalMatches: [
          ...matchSignals(text, GLOBAL_PATTERNS),
          ...missionMatches(text, args.globalMission, "global"),
        ],
        projectMatches: [
          ...matchSignals(text, PROJECT_PATTERNS),
          ...missionMatches(text, args.projectMission, "project"),
        ],
        skipMatches: matchSignals(text, SKIP_PATTERNS),
      });
    },
  };
}

export function createHeuristicMemoryRouter(): MemoryRouterAdapter {
  return createMissionAwareMemoryRouter();
}

function missionSummary(mission: string | undefined, fallback: string): string {
  if (!mission) return fallback;
  return mission.length > 120 ? `${mission.slice(0, 117)}...` : mission;
}

export function routeMemoryCandidate(
  args: MemoryRouteInput,
  adapter: MemoryRouterAdapter = createMissionAwareMemoryRouter(),
): MemoryRouteDecision {
  const projectMission = missionSummary(
    args.config.banks.project.retainMission,
    "built-in project retain mission",
  );
  const globalMission = missionSummary(
    args.config.banks.global.retainMission,
    "built-in global retain mission",
  );
  const classification = adapter.classify({
    content: args.content,
    ...(args.context ? { context: args.context } : {}),
    projectMission,
    globalMission,
  });
  const writes =
    args.config.globalRetain.mode === "router"
      ? classification.route === "both"
        ? ["project", "global"]
        : classification.route === "skip"
          ? []
          : [classification.route]
      : [];
  const reason =
    args.config.globalRetain.mode === "explicit-only"
      ? `dry-run only: globalRetain.mode=explicit-only; suggested=${classification.route}; signals=${classification.matchedSignals.join(", ") || "none"}`
      : `router mode: suggested=${classification.route}; signals=${classification.matchedSignals.join(", ") || "none"}`;

  return {
    ...classification,
    reason,
    mode: args.config.globalRetain.mode,
    writes,
    projectMission,
    globalMission,
  };
}
