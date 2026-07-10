import type {
  BankTemplateManifest,
  MinScores,
  TagGroupAndInput,
  TagGroupLeaf,
  TagGroupNotInput,
  TagGroupOrInput,
} from "@vectorize-io/hindsight-client";

export type Budget = "low" | "mid" | "high";
export type UpdateMode = "append" | "replace";
export type RetainUserContent = "text";
export type RetainAssistantContent = "text" | "toolCall" | "thinking";
export type RetainToolResultContent = "error" | "summary" | "content";
export type TagsMatch = "any" | "all" | "any_strict" | "all_strict" | "exact";
export type HindsightTagGroup =
  | TagGroupLeaf
  | TagGroupAndInput
  | TagGroupOrInput
  | TagGroupNotInput;
export type MentalModelDetail = "metadata" | "content" | "full";
export type MentalModelTagsMatch = "any" | "all" | "exact";
export type OperationStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type GraphFactType = "world" | "experience";
export type DocumentTagsMatch = "any" | "all" | "any_strict" | "all_strict";
export type TagSource = "memories" | "mental_models";
export type HindsightObservationScopes =
  | "per_tag"
  | "combined"
  | "all_combinations"
  | "shared"
  | string[][];
export type StatusStyle = "off" | "text" | "emoji" | "nerdfont";
export type StatusDetail = "minimal" | "project" | "activity" | "verbose";
export type RecallRole = "user" | "assistant" | "tool" | "system";
export type RecallInjectionPosition = "prepend" | "append";
export type GlobalRetainMode = "explicit-only";
export type ImportMode = "curated" | "raw" | "forensic";
export type ImportQualityProfile = "compatible" | "strict";
/** Agent use profile selects mental-model seed sets (coding vs conversation/life). */
export type AgentUseProfile = "coding" | "conversation";

/** Score fields Hindsight may return on recall results; used for optional local floors. */
export const RECALL_SCORE_FIELDS = ["semantic", "reranker", "final", "keyword"] as const;
export type RecallScoreField = (typeof RECALL_SCORE_FIELDS)[number];
export type RecallMinScores = Partial<Record<RecallScoreField, number>>;

export interface BankMissionSettings {
  retainMission?: string;
  reflectMission?: string;
  observationsMission?: string;
  retainStructuredChunkSize?: number;
}

export interface HindsightEntityInput {
  text: string;
  type?: string;
}

export interface ResolvedConfig {
  enabled: boolean;
  /**
   * When true, automatic memory network I/O is allowed.
   * Also treated as complete when bank ids, project config files, or legacy runtime state exist (ADR-005).
   */
  setupComplete: boolean;
  hindsight: { baseUrl: string; apiKey?: string; apiKeyRef?: string; timeoutMs: number };
  /** Selects default mental-model sets (coding vs conversation/real-life). */
  agentUse: AgentUseProfile;
  mentalModels: {
    /** When true, inject non-empty mental models into automatic context. */
    inject: boolean;
    /** Total character budget for injected mental-model blocks. */
    maxChars: number;
    /** Cache TTL for listMentalModels content used in automatic inject. */
    cacheTtlMs: number;
  };
  banks: {
    project: BankMissionSettings & {
      enabled: boolean;
      bankId?: string;
      derive: "repo" | "cwd" | "manual";
    };
    user: BankMissionSettings & { enabled: boolean; bankId?: string };
    global: BankMissionSettings & { enabled: boolean; bankId?: string };
  };
  recall: {
    enabled: boolean;
    budget: Budget;
    maxTokens: number;
    userMaxTokens: number;
    types: string[];
    includeSourceFacts: boolean;
    maxSourceFactsTokens: number;
    contextTurns: number;
    roles: RecallRole[];
    maxQueryChars: number;
    queryPreamble: string;
    projectQueryPreamble: string;
    globalQueryPreamble: string;
    userQueryPreamble?: string;
    includeDateInQuery: boolean;
    includeRepoHintsInQuery: boolean;
    storeLastRecall: boolean;
    storeLastRecallFailures: boolean;
    lastRecallPath: string;
    topK: number;
    timeoutMs: number;
    cacheTtlMs: number;
    injectionMode: "context";
    injectionPosition: RecallInjectionPosition;
    includeFactsInDebug: boolean;
    queryTimestamp?: string;
    preferObservations: boolean;
    /** Optional local floors for automatic recall injection. Omitted by default. */
    minScores?: RecallMinScores;
  };
  observations: {
    enabled: boolean;
    scopes: string[][];
  };
  userRetain: {
    mode: GlobalRetainMode;
  };
  globalRetain: {
    mode: GlobalRetainMode;
  };
  retain: {
    enabled: boolean;
    async: boolean;
    updateMode: UpdateMode;
    content: {
      user: RetainUserContent[];
      assistant: RetainAssistantContent[];
      toolResult: RetainToolResultContent[];
    };
    toolFilter: {
      toolCall: { include?: string[]; exclude?: string[] };
      toolResult: { include?: string[]; exclude?: string[] };
    };
    strip: {
      message: string[];
      topLevel: string[];
    };
    redactSecrets: boolean;
    entities: HindsightEntityInput[];
    queuePath: string;
    flushIntervalMs: number;
    periodicFlushMaxJobs: number;
    periodicFlushTimeoutMs: number;
    shutdownFlushMaxJobs: number;
    shutdownFlushTimeoutMs: number;
    postRetainReflect: boolean;
  };
  import: {
    mode: ImportMode;
    qualityProfile: ImportQualityProfile;
    turnsPerDocument: number;
    maxDocumentBytes: number;
    includeBranches: "current-only" | "all-leaves";
    toolResults: "errors-only" | "summary" | "content";
    toolResultSummaryMaxChars: number;
    replaceExistingImportedDocs: boolean;
    manifestPath: string;
    checkpointPath: string;
    resume: boolean;
  };
  status: {
    style: StatusStyle;
    detail: StatusDetail;
    maxLength: number;
    showActivity: boolean;
  };
  notifications: {
    startup: boolean;
    recall: boolean;
    retain: boolean;
  };
}

export interface BankSelection {
  projectBankId: string;
  globalBankId?: string;
}

export interface RecallResultItem {
  id?: string;
  text?: string;
  content?: string;
  type?: string;
  tags?: string[];
  metadata?: Record<string, string>;
  occurred_start?: string | null;
  source_fact_ids?: string[];
  sourceFacts?: string[];
  scores?: RecallResultScores;
}

export interface RecallResultScores {
  semantic?: number | null;
  reranker?: number | null;
  final?: number | null;
  keyword?: number | null;
}

export interface RecallFailure {
  bankId: string;
  query: string;
  error: string;
  kind?: "project" | "global";
  tagGroups?: HindsightTagGroup[];
}

export interface RecallBlock {
  bankId: string;
  query: string;
  rendered: string;
  memoryCount: number;
  results: RecallResultItem[];
}

export interface RetainOutcome {
  itemsCount?: number;
  operations?: number;
  tokens?: number;
}

export interface RetainJob {
  id: string;
  bankId: string;
  createdAt: string;
  documentId: string;
  updateMode: UpdateMode;
  item: {
    content: string;
    context: string;
    timestamp?: string;
    async?: boolean;
    tags?: string[];
    metadata?: Record<string, string>;
    observationScopes?: HindsightObservationScopes;
    documentTags?: string[];
    entities?: HindsightEntityInput[];
  };
  retries: number;
  lastError?: string;
  deadLetteredAt?: string;
}

export interface MentalModelSummary {
  id: string;
  name: string;
  content?: string;
  tags?: string[];
  lastRefreshedAt?: string;
}

export interface HindsightLikeClient {
  retain(
    bankId: string,
    content: string,
    options?: {
      timestamp?: Date | string;
      context?: string;
      metadata?: Record<string, string>;
      documentId?: string;
      documentTags?: string[];
      async?: boolean;
      entities?: HindsightEntityInput[];
      tags?: string[];
      updateMode?: UpdateMode;
      observationScopes?: HindsightObservationScopes;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  retainBatch?(
    bankId: string,
    items: Array<{
      content: string;
      timestamp?: Date | string;
      context?: string;
      metadata?: Record<string, string>;
      document_id?: string;
      entities?: Array<{ text: string; type?: string }>;
      tags?: string[];
      observation_scopes?: HindsightObservationScopes;
      update_mode?: UpdateMode;
    }>,
    options?: {
      documentId?: string;
      documentTags?: string[];
      async?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  recall(
    bankId: string,
    query: string,
    options?: {
      types?: string[];
      preferObservations?: boolean;
      maxTokens?: number;
      budget?: Budget;
      queryTimestamp?: string;
      trace?: boolean;
      includeEntities?: boolean;
      maxEntityTokens?: number;
      includeChunks?: boolean;
      maxChunkTokens?: number;
      includeSourceFacts?: boolean;
      maxSourceFactsTokens?: number;
      tags?: string[];
      tagsMatch?: TagsMatch;
      tagGroups?: HindsightTagGroup[];
      minScores?: MinScores;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  reflect(
    bankId: string,
    query: string,
    options?: {
      context?: string;
      budget?: Budget;
      maxTokens?: number;
      responseSchema?: Record<string, unknown>;
      includeFacts?: boolean;
      includeToolCalls?: boolean;
      includeToolCallOutput?: boolean;
      factTypes?: Array<"world" | "experience" | "observation">;
      excludeMentalModels?: boolean;
      excludeMentalModelIds?: string[];
      tags?: string[];
      tagsMatch?: TagsMatch;
      tagGroups?: HindsightTagGroup[];
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  createBank?(
    bankId: string,
    options?: {
      name?: string;
      reflectMission?: string;
      retainMission?: string;
      retainExtractionMode?: string;
      retainStructuredChunkSize?: number;
      enableObservations?: boolean;
      observationsMission?: string;
    },
  ): Promise<unknown>;
  getBankProfile?(bankId: string): Promise<unknown>;
  getBankStats?(bankId: string): Promise<unknown>;
  getBankConfig?(bankId: string): Promise<unknown>;
  importBankTemplate?(
    bankId: string,
    manifest: BankTemplateManifest,
    options?: { dryRun?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
  listMentalModels?(
    bankId: string,
    options?: { tags?: string[]; signal?: AbortSignal },
  ): Promise<unknown>;
  health?(): Promise<unknown>;
  getVersion?(): Promise<unknown>;
}
