export type Budget = "low" | "mid" | "high";
export type UpdateMode = "append" | "replace";
export type RetainUserContent = "text";
export type RetainAssistantContent = "text" | "toolCall" | "thinking";
export type RetainToolResultContent = "error" | "summary" | "content";
export type TagsMatch = "any" | "all" | "any_strict" | "all_strict";
export type StatusStyle = "off" | "text" | "emoji" | "nerdfont";
export type StatusDetail = "minimal" | "project" | "activity" | "verbose";
export type RecallRole = "user" | "assistant" | "tool" | "system";
export type RecallInjectionPosition = "prepend" | "append";

export interface ResolvedConfig {
  enabled: boolean;
  hindsight: { baseUrl: string; apiKey?: string; apiKeyRef?: string; timeoutMs: number };
  banks: {
    project: {
      enabled: boolean;
      bankId?: string;
      derive: "repo" | "cwd" | "manual";
      mission?: string;
    };
    global: { enabled: boolean; bankId?: string; mission?: string };
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
    includeDateInQuery: boolean;
    includeRepoHintsInQuery: boolean;
    storeLastRecall: boolean;
    lastRecallPath: string;
    topK: number;
    timeoutMs: number;
    injectionMode: "context";
    injectionPosition: RecallInjectionPosition;
    includeFactsInDebug: boolean;
  };
  observations: {
    enabled: boolean;
    scopes: string[][];
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
    queuePath: string;
    shutdownFlushMaxJobs: number;
    shutdownFlushTimeoutMs: number;
  };
  import: {
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
}
