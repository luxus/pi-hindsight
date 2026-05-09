import type {
  CreateDirectiveRequest,
  CreateMentalModelRequest,
  GetEntityGraphOptions,
  GetGraphOptions,
  GetMentalModelOptions,
  ListDocumentsOptions,
  ListEntitiesOptions,
  ListMemoriesOptions,
  ListDirectivesOptions,
  ListMentalModelsOptions,
  ListOperationsOptions,
  ListTagsOptions,
  ResolvedConfig,
  UpdateBankProfileRequest,
  UpdateDirectiveRequest,
  UpdateDocumentRequest,
  UpdateMentalModelRequest,
} from "./types.js";
import { redactError } from "./sanitize.js";

export interface HindsightRestTransport {
  request(path: string, init?: RequestInit): Promise<unknown>;
}

export interface HindsightHealthResponse {
  status?: string;
}

export interface HindsightReflectResponse {
  text?: string;
  result?: unknown;
}

export interface HindsightRestError extends Error {
  status?: number;
  body?: unknown;
}

function baseUrl(config: ResolvedConfig): string {
  return config.hindsight.baseUrl.replace(/\/$/, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertRestObject(value: unknown, operation: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${operation} returned non-object response`);
  return value;
}

export function assertHealthResponse(value: unknown): HindsightHealthResponse {
  return isRecord(value) ? (value as HindsightHealthResponse) : {};
}

export function assertReflectResponse(value: unknown): HindsightReflectResponse {
  return assertRestObject(value, "hindsight reflect") as HindsightReflectResponse;
}

export function createHindsightRestTransport(config: ResolvedConfig): HindsightRestTransport {
  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("User-Agent", "pi-hindsight/0.1.0");
      if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData))
        headers.set("Content-Type", "application/json");
      if (config.hindsight.apiKey)
        headers.set("Authorization", `Bearer ${config.hindsight.apiKey}`);
      const response = await fetch(`${baseUrl(config)}${path}`, { ...init, headers });
      const body = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        const rawMessage = `Hindsight request failed with status ${response.status}: ${JSON.stringify(body)}`;
        const error = new Error(redactError(rawMessage)) as HindsightRestError;
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    },
  };
}

export function reflectRequestBody(
  query: string,
  options: {
    context?: string;
    budget?: string;
    maxTokens?: number;
    responseSchema?: unknown;
    includeFacts?: boolean;
    includeToolCalls?: boolean;
    factTypes?: Array<"world" | "experience" | "observation">;
    excludeMentalModels?: boolean;
    excludeMentalModelIds?: string[];
    tags?: string[];
    tagsMatch?: string;
    tagGroups?: unknown[];
  } = {},
): Record<string, unknown> {
  return {
    query,
    ...(options.context ? { context: options.context } : {}),
    budget: options.budget ?? "low",
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(options.responseSchema ? { response_schema: options.responseSchema } : {}),
    ...(options.includeFacts !== undefined || options.includeToolCalls !== undefined
      ? {
          include: {
            ...(options.includeFacts !== undefined
              ? { facts: options.includeFacts ? {} : null }
              : {}),
            ...(options.includeToolCalls !== undefined
              ? { tool_calls: options.includeToolCalls ? {} : null }
              : {}),
          },
        }
      : {}),
    ...(options.factTypes ? { fact_types: options.factTypes } : {}),
    ...(options.excludeMentalModels !== undefined
      ? { exclude_mental_models: options.excludeMentalModels }
      : {}),
    ...(options.excludeMentalModelIds
      ? { exclude_mental_model_ids: options.excludeMentalModelIds }
      : {}),
    ...(options.tagGroups ? { tag_groups: options.tagGroups } : {}),
    ...(options.tagGroups ? {} : options.tags ? { tags: options.tags } : {}),
    ...(options.tagGroups ? {} : options.tagsMatch ? { tags_match: options.tagsMatch } : {}),
  };
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function encodeBankPath(bankId: string, suffix: string): string {
  return `/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}

export function chunkItemPath(chunkId: string): string {
  return `/v1/default/chunks/${encodeURIComponent(chunkId)}`;
}

export function operationsCollectionPath(
  bankId: string,
  options: ListOperationsOptions = {},
): string {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.taskType) params.set("type", options.taskType);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/operations"), params);
}

export function operationItemPath(bankId: string, operationId: string): string {
  return `${encodeBankPath(bankId, "/operations")}/${encodeURIComponent(operationId)}`;
}

export function operationCancelPath(bankId: string, operationId: string): string {
  return operationItemPath(bankId, operationId);
}

export function operationRetryPath(bankId: string, operationId: string): string {
  return `${operationItemPath(bankId, operationId)}/retry`;
}

export function memoriesCollectionPath(bankId: string, options: ListMemoriesOptions = {}): string {
  const params = new URLSearchParams();
  if (options.type) params.set("type", options.type);
  if (options.q) params.set("q", options.q);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/memories/list"), params);
}

export function memoryItemPath(bankId: string, memoryId: string): string {
  return `${encodeBankPath(bankId, "/memories")}/${encodeURIComponent(memoryId)}`;
}

export function memoryHistoryPath(bankId: string, memoryId: string): string {
  return `${memoryItemPath(bankId, memoryId)}/history`;
}

export function memoryObservationsPath(bankId: string, memoryId: string): string {
  return `${memoryItemPath(bankId, memoryId)}/observations`;
}

export function documentsCollectionPath(
  bankId: string,
  options: ListDocumentsOptions = {},
): string {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  for (const tag of options.tags ?? []) params.append("tags", tag);
  if (options.tagsMatch) params.set("tags_match", options.tagsMatch);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/documents"), params);
}

export function documentItemPath(bankId: string, documentId: string): string {
  return `${encodeBankPath(bankId, "/documents")}/${encodeURIComponent(documentId)}`;
}

export function updateDocumentRequestBody(request: UpdateDocumentRequest): Record<string, unknown> {
  return {
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
  };
}

export function entitiesCollectionPath(bankId: string, options: ListEntitiesOptions = {}): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/entities"), params);
}

export function entityItemPath(bankId: string, entityId: string): string {
  return `${encodeBankPath(bankId, "/entities")}/${encodeURIComponent(entityId)}`;
}

export function entityRegeneratePath(bankId: string, entityId: string): string {
  return `${entityItemPath(bankId, entityId)}/regenerate`;
}

export function graphPath(bankId: string, options: GetGraphOptions = {}): string {
  const params = new URLSearchParams();
  if (options.type) params.set("type", options.type);
  if (options.q) params.set("q", options.q);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  for (const tag of options.tags ?? []) params.append("tags", tag);
  if (options.tagsMatch) params.set("tags_match", options.tagsMatch);
  if (options.documentId) params.set("document_id", options.documentId);
  if (options.chunkId) params.set("chunk_id", options.chunkId);
  return appendQuery(encodeBankPath(bankId, "/graph"), params);
}

export function entityGraphPath(bankId: string, options: GetEntityGraphOptions = {}): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.minCount !== undefined) params.set("min_count", String(options.minCount));
  return appendQuery(encodeBankPath(bankId, "/entities/graph"), params);
}

export function tagsCollectionPath(bankId: string, options: ListTagsOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  if (options.source) params.set("source", options.source);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/tags"), params);
}

export function bankConfigPath(bankId: string): string {
  return encodeBankPath(bankId, "/config");
}

export function bankProfilePath(bankId: string): string {
  return encodeBankPath(bankId, "/profile");
}

export function bankBackgroundPath(bankId: string): string {
  return encodeBankPath(bankId, "/background");
}

export function updateBankProfileRequestBody(
  request: UpdateBankProfileRequest,
): Record<string, unknown> {
  return {
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.mission !== undefined ? { mission: request.mission } : {}),
    ...(request.background !== undefined ? { background: request.background } : {}),
    ...(request.reflectMission !== undefined ? { reflect_mission: request.reflectMission } : {}),
    ...(request.retainMission !== undefined ? { retain_mission: request.retainMission } : {}),
    ...(request.observationsMission !== undefined
      ? { observations_mission: request.observationsMission }
      : {}),
  };
}

export function directivesCollectionPath(
  bankId: string,
  options: ListDirectivesOptions = {},
): string {
  const params = new URLSearchParams();
  for (const tag of options.tags ?? []) params.append("tags", tag);
  if (options.tagsMatch) params.set("tags_match", options.tagsMatch);
  if (options.activeOnly !== undefined) params.set("active_only", String(options.activeOnly));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/directives"), params);
}

export function directiveItemPath(bankId: string, directiveId: string): string {
  return `${encodeBankPath(bankId, "/directives")}/${encodeURIComponent(directiveId)}`;
}

export function bankTemplateImportPath(bankId: string, options: { dryRun?: boolean } = {}): string {
  return `${encodeBankPath(bankId, "/import")}${options.dryRun ? "?dry_run=true" : ""}`;
}

export function bankTemplateExportPath(bankId: string): string {
  return encodeBankPath(bankId, "/export");
}

export function bankTemplateSchemaPath(): string {
  return "/v1/bank-template-schema";
}

export function updateBankConfigRequestBody(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  return { updates };
}

export function mentalModelCollectionPath(
  bankId: string,
  options: ListMentalModelsOptions = {},
): string {
  const params = new URLSearchParams();
  for (const tag of options.tags ?? []) params.append("tags", tag);
  if (options.tagsMatch) params.set("tags_match", options.tagsMatch);
  if (options.detail) params.set("detail", options.detail);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return appendQuery(encodeBankPath(bankId, "/mental-models"), params);
}

export function mentalModelItemPath(
  bankId: string,
  mentalModelId: string,
  options: GetMentalModelOptions = {},
): string {
  const params = new URLSearchParams();
  if (options.detail) params.set("detail", options.detail);
  return appendQuery(
    `${encodeBankPath(bankId, "/mental-models")}/${encodeURIComponent(mentalModelId)}`,
    params,
  );
}

export function mentalModelHistoryPath(bankId: string, mentalModelId: string): string {
  return `${mentalModelItemPath(bankId, mentalModelId)}/history`;
}

export function mentalModelRefreshPath(bankId: string, mentalModelId: string): string {
  return `${mentalModelItemPath(bankId, mentalModelId)}/refresh`;
}

export function consolidationPath(bankId: string): string {
  return encodeBankPath(bankId, "/consolidate");
}

export function consolidationRecoverPath(bankId: string): string {
  return encodeBankPath(bankId, "/consolidation/recover");
}

export function observationsPath(bankId: string): string {
  return encodeBankPath(bankId, "/observations");
}

export function createDirectiveRequestBody(
  request: CreateDirectiveRequest,
): Record<string, unknown> {
  return {
    name: request.name,
    content: request.content,
    ...(request.priority !== undefined ? { priority: request.priority } : {}),
    ...(request.isActive !== undefined ? { is_active: request.isActive } : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
  };
}

export function updateDirectiveRequestBody(
  request: UpdateDirectiveRequest,
): Record<string, unknown> {
  return {
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.content !== undefined ? { content: request.content } : {}),
    ...(request.priority !== undefined ? { priority: request.priority } : {}),
    ...(request.isActive !== undefined ? { is_active: request.isActive } : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
  };
}

export function createMentalModelRequestBody(
  request: CreateMentalModelRequest,
): Record<string, unknown> {
  return {
    ...(request.id !== undefined ? { id: request.id } : {}),
    name: request.name,
    source_query: request.sourceQuery,
    ...(request.tags ? { tags: request.tags } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(request.trigger ? { trigger: request.trigger } : {}),
  };
}

export function updateMentalModelRequestBody(
  request: UpdateMentalModelRequest,
): Record<string, unknown> {
  return {
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.sourceQuery !== undefined ? { source_query: request.sourceQuery } : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(request.trigger !== undefined ? { trigger: request.trigger } : {}),
  };
}
