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

// Automatic-retain delivery cadence.
// - immediate: flush the queue after every agent_end (legacy, backward-compatible default).
// - coalesced: enqueue and merge compatible deltas for the same bank/document, deferring
//   remote delivery to the session boundary (shutdown) and any configured periodic flush.
//   This collapses many small per-run retain operations into few larger ones, cutting
//   Hindsight extraction/consolidation and Postgres WAL/write amplification.
export type RetainDelivery = "immediate" | "coalesced";
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

export type ScopeMode = "domain-tagged" | "isolated-bank";

export interface ScopeConfig {
  /**
   * domain-tagged: shared coding bank (banks.project.bankId) + project tags.
   * isolated-bank: path-derived or dedicated bank per repo (hard wall).
   */
  mode: ScopeMode;
  /** Explicit project id pin (wins over remote/basename). Written as tag project:<slug>. */
  projectId?: string;
  /**
   * How to derive project id when pin is unset.
   * remote = git origin URL (default); basename = git root folder name.
   */
  projectIdStrategy: "remote" | "basename";
  /**
   * When true, project recall ORs exact untagged (shared) observations with the
   * project tag filter. Default false — strict project isolation.
   * Not cross-bank; only untagged observations inside the same coding bank.
   */
  includeSharedObservations: boolean;
}

export interface ResolvedConfig {
  enabled: boolean;
  /**
   * When true, automatic memory network I/O is allowed.
   * Also treated as complete when bank ids, project config files, or legacy runtime state exist (ADR-005).
   */
  setupComplete: boolean;
  scope: ScopeConfig;
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
      /**
       * How to pick a bank id when banks.project.bankId is unset.
       * - repo/cwd: hashed `pi-project-<slug>-<pathHash>` (upstream default)
       * - basename: git-root folder name, Claude/Grok compatible (`my_websites`)
       * - manual: bankId is required; leftover hashed fallback if missing
       */
      derive: "repo" | "cwd" | "manual" | "basename";
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
    delivery: RetainDelivery;
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
    /**
     * When true (default), assistant tool calls retain name + primary target only
     * (no full args). Set false for full argument objects (debug / forensic).
     */
    compactToolCalls: boolean;
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
    /** Named bank retain strategy (conversation, git, gitlog, document, survey). */
    strategy?: string;
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
      /** Caller-supplied UUID for idempotent async retain retries. */
      operationId?: string;
      entities?: HindsightEntityInput[];
      tags?: string[];
      updateMode?: UpdateMode;
      observationScopes?: HindsightObservationScopes;
      /** Named bank retain strategy override for this item. */
      strategy?: string;
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
      strategy?: string;
    }>,
    options?: {
      documentId?: string;
      documentTags?: string[];
      async?: boolean;
      operationId?: string;
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
    options?: {
      tags?: string[];
      /** Exclude large content/provenance; prefer metadata for agent list. */
      detail?: "metadata" | "content" | "full";
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  getMentalModel?(
    bankId: string,
    mentalModelId: string,
    options?: {
      detail?: "metadata" | "content" | "full";
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  createMentalModel?(
    bankId: string,
    name: string,
    sourceQuery: string,
    options?: {
      id?: string;
      tags?: string[];
      maxTokens?: number;
      trigger?: {
        refreshAfterConsolidation?: boolean;
        tagsMatch?: TagsMatch;
      };
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  updateMentalModel?(
    bankId: string,
    mentalModelId: string,
    options: {
      name?: string;
      sourceQuery?: string;
      tags?: string[];
      maxTokens?: number;
      trigger?: {
        refreshAfterConsolidation?: boolean;
        tagsMatch?: TagsMatch;
      };
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  refreshMentalModel?(
    bankId: string,
    mentalModelId: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  deleteMentalModel?(
    bankId: string,
    mentalModelId: string,
    options?: { dryRun?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
  /** Knowledge pages (official wrappers in @vectorize-io/hindsight-client ^0.9.0). */
  getKnowledgeBaseTree?(bankId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  createKnowledgeFolder?(
    bankId: string,
    name: string,
    options?: { parentId?: string | null; signal?: AbortSignal },
  ): Promise<unknown>;
  createKnowledgePage?(
    bankId: string,
    name: string,
    sourceQuery: string,
    options?: {
      parentId?: string | null;
      tags?: string[];
      maxTokens?: number;
      /** When set, must restate page defaults (server replaces, does not merge). */
      trigger?: {
        mode?: "full" | "delta";
        refreshAfterConsolidation?: boolean;
        refreshCron?: string | null;
        factTypes?: Array<"world" | "experience" | "observation">;
        excludeMentalModels?: boolean;
        excludeMentalModelIds?: string[];
        tagsMatch?: TagsMatch;
        tagGroups?: HindsightTagGroup[];
        includeChunks?: boolean;
        recallMaxTokens?: number;
        recallChunksMaxTokens?: number;
      };
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  getKnowledgePage?(
    bankId: string,
    pageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  searchKnowledgeBase?(
    bankId: string,
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<unknown>;
  updateKnowledgeNode?(
    bankId: string,
    nodeId: string,
    options: {
      name?: string;
      parentId?: string | null;
      sourceQuery?: string;
      tags?: string[];
      maxTokens?: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  deleteKnowledgeNode?(
    bankId: string,
    nodeId: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  exportKnowledgeBase?(bankId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  updateBankConfig?(
    bankId: string,
    options: {
      reflectMission?: string;
      retainMission?: string;
      observationsMission?: string;
      enableObservations?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  health?(): Promise<unknown>;
  getVersion?(): Promise<unknown>;
}
