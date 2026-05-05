import type { BankTemplateManifest } from "./bank-template-catalog.js";

export type Budget = "low" | "mid" | "high";
export type UpdateMode = "append" | "replace";
export type RetainUserContent = "text";
export type RetainAssistantContent = "text" | "toolCall" | "thinking";
export type RetainToolResultContent = "error" | "summary" | "content";
export type TagsMatch = "any" | "all" | "any_strict" | "all_strict";
export type MentalModelDetail = "metadata" | "content" | "full";
export type MentalModelTagsMatch = "any" | "all" | "exact";
export type StatusStyle = "off" | "text" | "emoji" | "nerdfont";
export type StatusDetail = "minimal" | "project" | "activity" | "verbose";
export type RecallRole = "user" | "assistant" | "tool" | "system";
export type RecallInjectionPosition = "prepend" | "append";
export type GlobalRetainMode = "explicit-only" | "router";
export type ImportMode = "curated" | "raw" | "forensic";

export interface BankMissionSettings {
  retainMission?: string;
  reflectMission?: string;
  observationsMission?: string;
}

export interface HindsightEntityInput {
  text: string;
  type?: string;
}

export interface ResolvedConfig {
  enabled: boolean;
  hindsight: { baseUrl: string; apiKey?: string; apiKeyRef?: string; timeoutMs: number };
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
    types: string[];
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
    injectionMode: "context";
    injectionPosition: RecallInjectionPosition;
    includeFactsInDebug: boolean;
    queryTimestamp?: string;
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
  };
  import: {
    mode: ImportMode;
    turnsPerDocument: number;
    maxDocumentBytes: number;
    includeBranches: "current-only" | "all-leaves";
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
}

export interface RecallFailure {
  bankId: string;
  query: string;
  error: string;
  kind?: "project" | "global";
  tags?: string[];
  tagsMatch?: TagsMatch;
}

export interface RecallBlock {
  bankId: string;
  query: string;
  rendered: string;
  memoryCount: number;
  results: RecallResultItem[];
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
    observationScopes?: string[][];
    entities?: HindsightEntityInput[];
  };
  retries: number;
  lastError?: string;
  deadLetteredAt?: string;
}

export interface HindsightCapabilities {
  version?: string;
  appendUpdateMode: boolean;
  checkedAt: string;
  error?: string;
  probeDocumentId?: string;
}

export interface MentalModelTrigger {
  mode?: "full" | "delta";
  refresh_after_consolidation?: boolean;
  fact_types?: Array<"world" | "experience" | "observation"> | null;
  exclude_mental_models?: boolean;
  exclude_mental_model_ids?: string[] | null;
  tags_match?: TagsMatch | null;
  tag_groups?: unknown[] | null;
  include_chunks?: boolean | null;
  recall_max_tokens?: number | null;
  recall_chunks_max_tokens?: number | null;
}

export interface CreateMentalModelRequest {
  id?: string | null;
  name: string;
  sourceQuery: string;
  tags?: string[];
  maxTokens?: number;
  trigger?: MentalModelTrigger;
}

export interface UpdateMentalModelRequest {
  name?: string | null;
  sourceQuery?: string | null;
  tags?: string[] | null;
  maxTokens?: number | null;
  trigger?: MentalModelTrigger | null;
}

export interface ListMentalModelsOptions {
  tags?: string[];
  tagsMatch?: MentalModelTagsMatch;
  detail?: MentalModelDetail;
  limit?: number;
  offset?: number;
}

export interface GetMentalModelOptions {
  detail?: MentalModelDetail;
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
      async?: boolean;
      entities?: HindsightEntityInput[];
      tags?: string[];
      updateMode?: UpdateMode;
      observationScopes?: string[][];
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
      observation_scopes?: string[][];
      update_mode?: UpdateMode;
    }>,
    options?: { documentId?: string; documentTags?: string[]; async?: boolean },
  ): Promise<unknown>;
  recall(
    bankId: string,
    query: string,
    options?: {
      types?: string[];
      maxTokens?: number;
      budget?: Budget;
      queryTimestamp?: string;
      tags?: string[];
      tagsMatch?: TagsMatch;
    },
  ): Promise<unknown>;
  reflect(
    bankId: string,
    query: string,
    options?: {
      context?: string;
      budget?: Budget;
      responseSchema?: Record<string, unknown>;
      tags?: string[];
      tagsMatch?: TagsMatch;
    },
  ): Promise<unknown>;
  createBank?(
    bankId: string,
    options?: {
      name?: string;
      reflectMission?: string;
      retainMission?: string;
      retainExtractionMode?: string;
      enableObservations?: boolean;
      observationsMission?: string;
    },
  ): Promise<unknown>;
  getBankProfile?(bankId: string): Promise<unknown>;
  getBankStats?(bankId: string): Promise<unknown>;
  getBankConfig?(bankId: string): Promise<unknown>;
  updateBankConfig?(bankId: string, updates: Record<string, unknown>): Promise<unknown>;
  resetBankConfig?(bankId: string): Promise<unknown>;
  health?(): Promise<unknown>;
  deleteDocument?(bankId: string, documentId: string): Promise<unknown>;
  importBankTemplate?(
    bankId: string,
    manifest: BankTemplateManifest,
    options?: { dryRun?: boolean },
  ): Promise<unknown>;
  exportBankTemplate?(bankId: string): Promise<BankTemplateManifest>;
  listMentalModels?(bankId: string, options?: ListMentalModelsOptions): Promise<unknown>;
  getMentalModel?(
    bankId: string,
    mentalModelId: string,
    options?: GetMentalModelOptions,
  ): Promise<unknown>;
  createMentalModel?(bankId: string, request: CreateMentalModelRequest): Promise<unknown>;
  updateMentalModel?(
    bankId: string,
    mentalModelId: string,
    request: UpdateMentalModelRequest,
  ): Promise<unknown>;
  deleteMentalModel?(bankId: string, mentalModelId: string): Promise<unknown>;
  getMentalModelHistory?(bankId: string, mentalModelId: string): Promise<unknown>;
  refreshMentalModel?(bankId: string, mentalModelId: string): Promise<unknown>;
}
