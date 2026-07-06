import {
  CLIENT_VERSION,
  HindsightClient,
  HindsightError,
  createClient,
  createConfig,
  sdk,
} from "@vectorize-io/hindsight-client";
import type { BankTemplateManifest, Client, ReflectRequest } from "@vectorize-io/hindsight-client";
import { redactError } from "../utils/sanitize.js";
import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { PI_HINDSIGHT_USER_AGENT } from "../version.js";
import { withRetry } from "./client-retry.js";
import { installFetchRequestCompat } from "./fetch-compat.js";
import { withTimeout } from "./timeout.js";

type ReflectOptions = Parameters<HindsightLikeClient["reflect"]>[2];
type RetainOptions = Parameters<HindsightLikeClient["retain"]>[2];

function sdkHeaders(config: ResolvedConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": PI_HINDSIGHT_USER_AGENT,
  };
  if (config.hindsight.apiKey) headers.Authorization = `Bearer ${config.hindsight.apiKey}`;
  return headers;
}

function createLowLevelClient(config: ResolvedConfig): Client {
  return createClient(
    createConfig({
      baseUrl: config.hindsight.baseUrl.replace(/\/$/, ""),
      headers: sdkHeaders(config),
    }),
  );
}

function unwrapSdkResponse<T>(
  response: { data?: T; error?: unknown; response?: Response },
  operation: string,
): T {
  if (response.data !== undefined) return response.data;
  const error = response.error as { detail?: unknown; message?: string } | undefined;
  const statusCode = response.response?.status;
  const details = error?.detail ?? error?.message ?? error;
  throw new HindsightError(`${operation} failed: ${JSON.stringify(details)}`, statusCode, details);
}

function reflectInclude(options: ReflectOptions): ReflectRequest["include"] | undefined {
  if (options?.includeFacts === undefined && options?.includeToolCalls === undefined) {
    return undefined;
  }
  const include: NonNullable<ReflectRequest["include"]> = {};
  if (options?.includeFacts !== undefined) {
    include.facts = options.includeFacts ? {} : null;
  }
  if (options?.includeToolCalls !== undefined) {
    include.tool_calls = options.includeToolCalls
      ? options.includeToolCallOutput === false
        ? { output: false }
        : {}
      : null;
  }
  return include;
}

function reflectRequestBody(query: string, options: ReflectOptions | undefined): ReflectRequest {
  const body: ReflectRequest = {
    query,
    budget: options?.budget ?? "low",
  };
  if (options?.context) body.context = options.context;
  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options?.responseSchema) body.response_schema = options.responseSchema;
  if (options?.factTypes) body.fact_types = options.factTypes;
  if (options?.excludeMentalModels !== undefined) {
    body.exclude_mental_models = options.excludeMentalModels;
  }
  if (options?.excludeMentalModelIds) {
    body.exclude_mental_model_ids = options.excludeMentalModelIds;
  }
  if (options?.tagGroups) body.tag_groups = options.tagGroups;
  else if (options?.tags) body.tags = options.tags;
  if (!options?.tagGroups && options?.tagsMatch) body.tags_match = options.tagsMatch;
  const include = reflectInclude(options);
  if (include) body.include = include;
  return body;
}

function retainBatchItem(content: string, options: RetainOptions) {
  return {
    content,
    ...(options?.timestamp ? { timestamp: options.timestamp } : {}),
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.documentId ? { document_id: options.documentId } : {}),
    ...(options?.entities?.length ? { entities: options.entities } : {}),
    ...(options?.tags ? { tags: options.tags } : {}),
    ...(options?.observationScopes?.length
      ? { observation_scopes: options.observationScopes }
      : {}),
    ...(options?.updateMode ? { update_mode: options.updateMode } : {}),
  };
}

function retainSingle(
  raw: HindsightClient,
  bankId: string,
  content: string,
  options: RetainOptions,
  signal: AbortSignal,
) {
  if (options?.documentTags?.length) {
    return raw.retainBatch(bankId, [retainBatchItem(content, options)], {
      ...(options.async !== undefined ? { async: options.async } : {}),
      documentTags: options.documentTags,
      signal,
    });
  }

  const { documentTags: _documentTags, signal: _signal, ...retainOptions } = options ?? {};
  return raw.retain(bankId, content, { ...retainOptions, signal });
}

async function reflect(
  args: {
    raw: HindsightClient;
    lowLevel: Client;
    bankId: string;
    query: string;
    options: ReflectOptions;
  },
  signal: AbortSignal,
): Promise<unknown> {
  if (args.options?.maxTokens !== undefined) {
    const response = await sdk.reflect({
      client: args.lowLevel,
      path: { bank_id: args.bankId },
      body: reflectRequestBody(args.query, args.options),
      signal,
    });
    return unwrapSdkResponse(response, "reflect");
  }

  return args.raw.reflect(args.bankId, args.query, { ...args.options, signal });
}

async function importBankTemplate(
  lowLevel: Client,
  bankId: string,
  manifest: BankTemplateManifest,
  options: { dryRun?: boolean } | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await sdk.importBankTemplate({
    client: lowLevel,
    path: { bank_id: bankId },
    ...(options?.dryRun ? { query: { dry_run: true } } : {}),
    // The generated SDK types `body` as `never` for this endpoint: the OpenAPI schema
    // declares a raw JSON object rather than a typed model. The request body is still the
    // documented BankTemplateManifest shape (Hindsight's Bank Templates API docs).
    body: manifest as never,
    signal,
  });
  return unwrapSdkResponse(response, "importBankTemplate");
}

export function createHindsightClient(config: ResolvedConfig): HindsightLikeClient {
  installFetchRequestCompat();

  const raw = new HindsightClient({
    baseUrl: config.hindsight.baseUrl,
    ...(config.hindsight.apiKey ? { apiKey: config.hindsight.apiKey } : {}),
    userAgent: PI_HINDSIGHT_USER_AGENT,
  });
  const lowLevel = createLowLevelClient(config);
  const timeoutMs = config.hindsight.timeoutMs;

  return {
    retain: (bankId, content, options) =>
      withTimeout(
        "hindsight retain",
        timeoutMs,
        (signal) => retainSingle(raw, bankId, content, options, signal),
        options?.signal,
      ),
    retainBatch: (...args) =>
      withTimeout(
        "hindsight retainBatch",
        timeoutMs,
        (signal) => {
          const [bankId, items, options] = args;
          return raw.retainBatch(bankId, items, { ...options, signal });
        },
        args[2]?.signal,
      ),
    recall: (...args) => {
      const [bankId, query, options] = args;
      return withTimeout(
        "hindsight recall",
        timeoutMs,
        (signal) => raw.recall(bankId, query, { ...options, signal }),
        options?.signal,
      );
    },
    reflect: (bankId, query, options) =>
      withTimeout(
        "hindsight reflect",
        timeoutMs,
        (signal) => reflect({ raw, lowLevel, bankId, query, options }, signal),
        options?.signal,
      ),
    createBank: (...args) =>
      withTimeout("hindsight createBank", timeoutMs, (signal) => {
        const [bankId, options] = args;
        return raw.createBank(bankId, { ...options, signal });
      }),
    getBankProfile: (...args) =>
      withTimeout("hindsight getBankProfile", timeoutMs, (signal) =>
        withRetry("getBankProfile", () => raw.getBankProfile(args[0], { signal })),
      ),
    getBankStats: (bankId) =>
      withTimeout("hindsight getBankStats", timeoutMs, (signal) =>
        withRetry("getBankStats", async () => {
          const response = await sdk.getAgentStats({
            client: lowLevel,
            path: { bank_id: bankId },
            signal,
          });
          return unwrapSdkResponse(response, "getBankStats");
        }),
      ),
    getBankConfig: (bankId) =>
      withTimeout("hindsight getBankConfig", timeoutMs, (signal) =>
        withRetry("getBankConfig", () => raw.getBankConfig(bankId, { signal })),
      ),
    importBankTemplate: (bankId, manifest, options) =>
      withTimeout(
        "hindsight importBankTemplate",
        timeoutMs,
        (signal) => importBankTemplate(lowLevel, bankId, manifest, options, signal),
        options?.signal,
      ),
    health: () =>
      withTimeout("hindsight health", timeoutMs, (signal) =>
        withRetry("health", async () => {
          const response = await sdk.healthEndpointHealthGet({ client: lowLevel, signal });
          return unwrapSdkResponse(response, "health");
        }),
      ),
    getVersion: () =>
      withTimeout("hindsight getVersion", timeoutMs, (signal) =>
        withRetry("getVersion", () => raw.getVersion({ signal })),
      ),
  };
}

export async function checkHindsight(
  client: HindsightLikeClient,
  bankId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (client.health) await client.health();
    else if (client.getBankProfile) await client.getBankProfile(bankId);
    else await client.recall(bankId, "health check", { maxTokens: 1, budget: "low" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: redactError(error) };
  }
}

export const HINDSIGHT_CLIENT_VERSION = CLIENT_VERSION;
