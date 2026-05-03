import type { ResolvedConfig } from "./types.js";

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

export function encodeBankPath(bankId: string, suffix: string): string {
  return `/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}
