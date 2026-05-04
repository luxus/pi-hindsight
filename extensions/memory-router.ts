import { baseTags, deriveProjectBankId } from "./banking.js";
import { stableSessionId } from "./session.js";
import type {
  MemoryRoute,
  MemoryRouteClassification,
  MemoryRouteDecision,
  MemoryRouterAdapter,
  MemoryRouteSignal,
  MemoryRouteTargetPreview,
  RoutingBankRole,
  RoutingCandidate,
  RoutingStrategy,
  RoutingStrategyInput,
} from "./routing-strategy.js";
import type { ResolvedConfig } from "./types.js";

export type {
  MemoryRoute,
  MemoryRouteClassification,
  MemoryRouteDecision,
  MemoryRouterAdapter,
  MemoryRouteSignal,
  MemoryRouteTargetPreview,
  RoutingBankRole,
  RoutingCandidate as MemoryRouteInput,
  RoutingStrategy,
  RoutingStrategyInput,
} from "./routing-strategy.js";

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

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer|api[_-]?key|token|cookie|secret|password)\b/i, "secret-like content"],
  [/https?:\/\/[^\s]*\b(private|internal|token|key)\b[^\s]*/i, "private URL"],
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

export function createMissionAwareMemoryRouter(): RoutingStrategy {
  return {
    classify(args) {
      const text = `${args.content}\n${args.context ?? ""}`;
      return classifyFromSignals({
        globalMatches: [
          ...matchSignals(text, GLOBAL_PATTERNS),
          ...missionMatches(text, args.missions.global, "global"),
        ],
        projectMatches: [
          ...matchSignals(text, PROJECT_PATTERNS),
          ...missionMatches(text, args.missions.project, "project"),
        ],
        skipMatches: matchSignals(text, SKIP_PATTERNS),
      });
    },
  };
}

export function createHeuristicMemoryRouter(): RoutingStrategy {
  return createMissionAwareMemoryRouter();
}

function missionSummary(mission: string | undefined, fallback: string): string {
  if (!mission) return fallback;
  return mission.length > 120 ? `${mission.slice(0, 117)}...` : mission;
}

function previewTags(args: { cwd?: string; sessionFile?: string }): string[] {
  if (!args.cwd) return [];
  return baseTags(args.cwd, stableSessionId(args.sessionFile, args.cwd));
}

function routeTargets(args: {
  route: MemoryRoute;
  config: ResolvedConfig;
  writes: string[];
  cwd?: string;
  projectBankId?: string;
  sessionFile?: string;
}): MemoryRouteTargetPreview[] {
  const targets: MemoryRouteTargetPreview[] = [];
  if (args.route === "project" || args.route === "both") {
    const bankId =
      args.projectBankId ??
      args.config.banks.project.bankId ??
      (args.cwd ? deriveProjectBankId(args.cwd, args.config) : undefined);
    if (bankId) {
      targets.push({
        bankRole: "project",
        bankId,
        tags: previewTags({
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
        }),
        willWrite: args.writes.includes("project"),
      });
    }
  }
  if (args.route === "global" || args.route === "both") {
    const bankId = args.config.banks.global.enabled ? args.config.banks.global.bankId : undefined;
    if (bankId) {
      targets.push({
        bankRole: "global",
        bankId,
        tags: previewTags({
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
        }),
        willWrite: args.writes.includes("global"),
      });
    }
  }
  return targets;
}

function safetyNotes(args: {
  text: string;
  route: MemoryRoute;
  mode: ResolvedConfig["globalRetain"]["mode"];
}) {
  const notes: string[] = [];
  const secretMatches = matchSignals(args.text, SECRET_PATTERNS);
  if (secretMatches.length) notes.push(`review/redact before retain: ${secretMatches.join(", ")}`);
  if (args.mode === "explicit-only")
    notes.push("dry-run only; no automatic writes in explicit-only mode");
  if (args.route === "global" || args.route === "both") {
    notes.push("global memory candidate; keep only durable cross-project facts");
  }
  if (args.route === "skip")
    notes.push("skip candidate; do not retain transient or unsafe content");
  return notes;
}

export function routeMemoryCandidate(
  args: RoutingCandidate,
  strategy: RoutingStrategy = createMissionAwareMemoryRouter(),
): MemoryRouteDecision {
  const projectMission = missionSummary(
    args.config.banks.project.retainMission,
    "built-in project retain mission",
  );
  const globalMission = missionSummary(
    args.config.banks.global.retainMission,
    "built-in global retain mission",
  );
  const strategyInput: RoutingStrategyInput = {
    content: args.content,
    ...(args.context ? { context: args.context } : {}),
    config: args.config,
    missions: { project: projectMission, global: globalMission },
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.projectBankId ? { projectBankId: args.projectBankId } : {}),
    ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
  };
  const classification = strategy.classify(strategyInput);
  const candidateWrites: RoutingBankRole[] =
    args.config.globalRetain.mode === "router"
      ? classification.route === "both"
        ? ["project", "global"]
        : classification.route === "skip"
          ? []
          : [classification.route as RoutingBankRole]
      : [];
  const writes = candidateWrites.filter((target) =>
    target === "project"
      ? args.config.banks.project.enabled
      : args.config.banks.global.enabled && Boolean(args.config.banks.global.bankId),
  );
  const text = `${args.content}\n${args.context ?? ""}`;
  const reason =
    args.config.globalRetain.mode === "explicit-only"
      ? `dry-run only: globalRetain.mode=explicit-only; suggested=${classification.route}; signals=${classification.matchedSignals.join(", ") || "none"}`
      : `router mode: suggested=${classification.route}; signals=${classification.matchedSignals.join(", ") || "none"}`;

  return {
    ...classification,
    reason,
    mode: args.config.globalRetain.mode,
    writes,
    targets: routeTargets({
      route: classification.route,
      config: args.config,
      writes,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      ...(args.projectBankId ? { projectBankId: args.projectBankId } : {}),
      ...(args.sessionFile ? { sessionFile: args.sessionFile } : {}),
    }),
    safetyNotes: safetyNotes({
      text,
      route: classification.route,
      mode: args.config.globalRetain.mode,
    }),
    projectMission,
    globalMission,
  };
}
