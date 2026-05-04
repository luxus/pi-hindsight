import type { ResolvedConfig } from "./types.js";

export type MemoryRoute = "project" | "global" | "both" | "skip";
export type MemoryRouteSignal = "global" | "project" | "skip";
export type RoutingBankRole = "project" | "global";

export interface RoutingCandidate {
  content: string;
  context?: string;
  config: ResolvedConfig;
  cwd?: string;
  projectBankId?: string;
  sessionFile?: string;
}

export interface RoutingStrategyInput {
  content: string;
  context?: string;
  config: ResolvedConfig;
  missions: {
    project: string;
    global: string;
  };
  cwd?: string;
  projectBankId?: string;
  sessionFile?: string;
}

export interface MemoryRouteClassification {
  route: MemoryRoute;
  confidence: number;
  signals: MemoryRouteSignal[];
  matchedSignals: string[];
}

export interface RoutingStrategy {
  classify(args: RoutingStrategyInput): MemoryRouteClassification;
}

export type MemoryRouterAdapter = RoutingStrategy;

export interface MemoryRouteTargetPreview {
  bankRole: RoutingBankRole;
  bankId: string;
  tags: string[];
  willWrite: boolean;
}

export interface MemoryRouteDecision extends MemoryRouteClassification {
  reason: string;
  mode: ResolvedConfig["globalRetain"]["mode"];
  writes: RoutingBankRole[];
  targets: MemoryRouteTargetPreview[];
  safetyNotes: string[];
  projectMission: string;
  globalMission: string;
}
