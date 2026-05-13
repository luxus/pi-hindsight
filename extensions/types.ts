import type {
  TagGroupAndInput,
  TagGroupLeaf,
  TagGroupNotInput,
  TagGroupOrInput,
} from "@vectorize-io/hindsight-client";
import type { BankTemplateManifest } from "./banks/bank-template-catalog.js";

export type Budget = "low" | "mid" | "high";
export type UpdateMode = "append" | "replace";
export type RetainUserContent = "text";
export type RetainAssistantContent = "text" | "toolCall" | "thinking";
export type RetainToolResultContent = "error" | "summary" | "content";
export type TagsMatch = "any" | "all" | "any_strict" | "all_strict";
export type HindsightTagGroup =
  | TagGroupLeaf
  | TagGroupAndInput
  | TagGroupOrInput
  | TagGroupNotInput;
export type MentalModelDetail = "metadata" | "content" | "full";
export type MentalModelTagsMatch = "any" | "all" | "exact";
export type OperationStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type GraphFactType = "world" | "experience" | "opinion";
export type DocumentTagsMatch = "any" | "all" | "any_strict" | "all_strict";
export type TagSource = "memories" | "mental_models";
export type HindsightObservationScopes = "per_tag" | "combined" | "all_combinations" | string[][];
export type StatusStyle = "off" | "text" | "emoji" | "nerdfont";
export type StatusDetail = "minimal" | "project" | "activity" | "verbose";
export type RecallRole = "user" | "assistant" | "tool" | "system";
export type RecallInjectionPosition = "prepend" | "append";
export type GlobalRetainMode = "explicit-only" | "router";
export type ImportMode = "curated" | "raw" | "forensic";
export type ImportQualityProfile = "compatible" | "strict";

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
    observationScopes?: HindsightObservationScopes;
    documentTags?: string[];
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

export interface ListDirectivesOptions {
  tags?: string[];
  tagsMatch?: "any" | "all" | "exact";
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateDirectiveRequest {
  name: string;
  content: string;
  priority?: number;
  isActive?: boolean;
  tags?: string[];
}

export interface UpdateDirectiveRequest {
  name?: string | null;
  content?: string | null;
  priority?: number | null;
  isActive?: boolean | null;
  tags?: string[] | null;
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

export interface ListOperationsOptions {
  status?: OperationStatus;
  taskType?: string;
  limit?: number;
  offset?: number;
}

export interface ListMemoriesOptions {
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ListDocumentsOptions {
  q?: string;
  tags?: string[];
  tagsMatch?: DocumentTagsMatch;
  limit?: number;
  offset?: number;
}

export interface UpdateDocumentRequest {
  tags?: string[] | null;
}

export interface RetainFileMetadata {
  context?: string;
  documentId?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface ListEntitiesOptions {
  limit?: number;
  offset?: number;
}

export interface GetGraphOptions {
  type?: string;
  q?: string;
  limit?: number;
  tags?: string[];
  tagsMatch?: string;
  documentId?: string;
  chunkId?: string;
}

export interface GetEntityGraphOptions {
  limit?: number;
  minCount?: number;
}

export interface ListTagsOptions {
  q?: string;
  source?: TagSource;
  limit?: number;
  offset?: number;
}

export interface DispositionTraits {
  skepticism: number;
  literalism: number;
  empathy: number;
}

export interface UpdateBankProfileRequest {
  name?: string | null;
  mission?: string | null;
  background?: string | null;
  reflectMission?: string | null;
  retainMission?: string | null;
  observationsMission?: string | null;
}

export interface AddBankBackgroundRequest {
  content: string;
  updateDisposition?: boolean;
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
  retainFiles?(
    bankId: string,
    files: Array<File | Blob>,
    options?: {
      context?: string;
      filesMetadata?: RetainFileMetadata[];
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  recall(
    bankId: string,
    query: string,
    options?: {
      types?: string[];
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
  listDocuments?(bankId: string, options?: ListDocumentsOptions): Promise<unknown>;
  getDocument?(bankId: string, documentId: string): Promise<unknown>;
  updateDocument?(
    bankId: string,
    documentId: string,
    request: UpdateDocumentRequest,
  ): Promise<unknown>;
  deleteDocument?(bankId: string, documentId: string): Promise<unknown>;
  listEntities?(bankId: string, options?: ListEntitiesOptions): Promise<unknown>;
  getEntity?(bankId: string, entityId: string): Promise<unknown>;
  regenerateEntity?(bankId: string, entityId: string): Promise<unknown>;
  getGraph?(bankId: string, options?: GetGraphOptions): Promise<unknown>;
  getEntityGraph?(bankId: string, options?: GetEntityGraphOptions): Promise<unknown>;
  listTags?(bankId: string, options?: ListTagsOptions): Promise<unknown>;
  updateBankProfile?(bankId: string, request: UpdateBankProfileRequest): Promise<unknown>;
  updateBankDisposition?(bankId: string, disposition: DispositionTraits): Promise<unknown>;
  addBankBackground?(bankId: string, request: AddBankBackgroundRequest): Promise<unknown>;
  importBankTemplate?(
    bankId: string,
    manifest: BankTemplateManifest,
    options?: { dryRun?: boolean },
  ): Promise<unknown>;
  exportBankTemplate?(bankId: string): Promise<BankTemplateManifest>;
  getBankTemplateSchema?(): Promise<unknown>;
  listDirectives?(bankId: string, options?: ListDirectivesOptions): Promise<unknown>;
  getDirective?(bankId: string, directiveId: string): Promise<unknown>;
  createDirective?(bankId: string, request: CreateDirectiveRequest): Promise<unknown>;
  updateDirective?(
    bankId: string,
    directiveId: string,
    request: UpdateDirectiveRequest,
  ): Promise<unknown>;
  deleteDirective?(bankId: string, directiveId: string): Promise<unknown>;
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
  triggerConsolidation?(bankId: string): Promise<unknown>;
  recoverConsolidation?(bankId: string): Promise<unknown>;
  clearObservations?(bankId: string): Promise<unknown>;
  listOperations?(bankId: string, options?: ListOperationsOptions): Promise<unknown>;
  cancelOperation?(bankId: string, operationId: string): Promise<unknown>;
  retryOperation?(bankId: string, operationId: string): Promise<unknown>;
  listMemories?(bankId: string, options?: ListMemoriesOptions): Promise<unknown>;
  getMemory?(bankId: string, memoryId: string): Promise<unknown>;
  getChunk?(chunkId: string): Promise<unknown>;
  getMemoryHistory?(bankId: string, memoryId: string): Promise<unknown>;
  deleteMemoryObservations?(bankId: string, memoryId: string): Promise<unknown>;
}
