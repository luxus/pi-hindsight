import type {
  CreateMentalModelRequest,
  GetMentalModelOptions,
  ListMentalModelsOptions,
  ResolvedConfig,
  UpdateMentalModelRequest,
} from "./types.js";

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
      if (!headers.has("Content-Type") && init.body)
        headers.set("Content-Type", "application/json");
      if (config.hindsight.apiKey)
        headers.set("Authorization", `Bearer ${config.hindsight.apiKey}`);
      const response = await fetch(`${baseUrl(config)}${path}`, { ...init, headers });
      const body = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        const error = new Error(
          `Hindsight request failed with status ${response.status}: ${JSON.stringify(body)}`,
        ) as HindsightRestError;
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
    responseSchema?: unknown;
    tags?: string[];
    tagsMatch?: string;
  } = {},
): Record<string, unknown> {
  return {
    query,
    ...(options.context ? { context: options.context } : {}),
    budget: options.budget ?? "low",
    ...(options.responseSchema ? { response_schema: options.responseSchema } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.tagsMatch ? { tags_match: options.tagsMatch } : {}),
  };
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function encodeBankPath(bankId: string, suffix: string): string {
  return `/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}

export function bankConfigPath(bankId: string): string {
  return encodeBankPath(bankId, "/config");
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
