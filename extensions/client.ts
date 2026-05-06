import { HindsightClient } from "@vectorize-io/hindsight-client";
import { redactError } from "./sanitize.js";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import {
  assertHealthResponse,
  assertReflectResponse,
  bankConfigPath,
  bankTemplateExportPath,
  bankTemplateImportPath,
  bankTemplateSchemaPath,
  createDirectiveRequestBody,
  createHindsightRestTransport,
  createMentalModelRequestBody,
  directiveItemPath,
  directivesCollectionPath,
  encodeBankPath,
  mentalModelCollectionPath,
  mentalModelHistoryPath,
  mentalModelItemPath,
  mentalModelRefreshPath,
  reflectRequestBody,
  updateBankConfigRequestBody,
  updateDirectiveRequestBody,
  updateMentalModelRequestBody,
} from "./client-rest.js";
import { withTimeout } from "./timeout.js";

type ReflectOptions = Parameters<HindsightLikeClient["reflect"]>[2];

function retainBatchItem(content: string, options: Parameters<HindsightLikeClient["retain"]>[2]) {
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

async function reflect(
  args: {
    raw: HindsightClient;
    rest: ReturnType<typeof createHindsightRestTransport>;
    bankId: string;
    query: string;
    options: ReflectOptions;
  },
  signal: AbortSignal,
): Promise<unknown> {
  if (!args.options?.responseSchema)
    return args.raw.reflect(args.bankId, args.query, { ...args.options, signal });
  const response = await args.rest.request(encodeBankPath(args.bankId, "/reflect"), {
    method: "POST",
    signal,
    body: JSON.stringify(reflectRequestBody(args.query, args.options)),
  });
  return assertReflectResponse(response);
}

export function createHindsightClient(config: ResolvedConfig): HindsightLikeClient {
  const raw = new HindsightClient({
    baseUrl: config.hindsight.baseUrl,
    ...(config.hindsight.apiKey ? { apiKey: config.hindsight.apiKey } : {}),
    userAgent: "pi-hindsight/0.1.0",
  });
  const rest = createHindsightRestTransport(config);
  const timeoutMs = config.hindsight.timeoutMs;
  return {
    retain: (bankId, content, options) =>
      withTimeout(
        "hindsight retain",
        timeoutMs,
        (signal) =>
          raw.retainBatch(
            bankId,
            [retainBatchItem(content, options)],
            options?.async !== undefined ? { async: options.async, signal } : { signal },
          ),
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
        (signal) => {
          return raw.recall(bankId, query, { ...options, signal });
        },
        options?.signal,
      );
    },
    reflect: (bankId, query, options) =>
      withTimeout(
        "hindsight reflect",
        timeoutMs,
        (signal) => reflect({ raw, rest, bankId, query, options }, signal),
        options?.signal,
      ),
    createBank: (...args) =>
      withTimeout("hindsight createBank", timeoutMs, (signal) => {
        const [bankId, options] = args;
        return raw.createBank(bankId, { ...options, signal });
      }),
    getBankProfile: (...args) =>
      withTimeout("hindsight getBankProfile", timeoutMs, (signal) =>
        raw.getBankProfile(args[0], { signal }),
      ),
    getBankStats: (bankId) =>
      withTimeout("hindsight getBankStats", timeoutMs, (signal) =>
        rest.request(encodeBankPath(bankId, "/stats"), { signal }),
      ),
    getBankConfig: (bankId) =>
      withTimeout("hindsight getBankConfig", timeoutMs, (signal) =>
        rest.request(bankConfigPath(bankId), { signal }),
      ),
    updateBankConfig: (bankId, updates) =>
      withTimeout("hindsight updateBankConfig", timeoutMs, (signal) =>
        rest.request(bankConfigPath(bankId), {
          method: "PATCH",
          signal,
          body: JSON.stringify(updateBankConfigRequestBody(updates)),
        }),
      ),
    resetBankConfig: (bankId) =>
      withTimeout("hindsight resetBankConfig", timeoutMs, (signal) =>
        rest.request(bankConfigPath(bankId), { method: "DELETE", signal }),
      ),
    health: () =>
      withTimeout("hindsight health", timeoutMs, async (signal) =>
        assertHealthResponse(await rest.request("/health", { signal })),
      ),
    deleteDocument: (bankId, documentId) =>
      withTimeout("hindsight deleteDocument", timeoutMs, (signal) =>
        rest.request(`${encodeBankPath(bankId, "/documents")}/${encodeURIComponent(documentId)}`, {
          method: "DELETE",
          signal,
        }),
      ),
    // The installed high-level SDK does not export bank-template helpers. Its generated
    // import helper also exposes no typed body because the server endpoint accepts raw JSON.
    // Keep a narrow REST shim for template import/export/schema until the public SDK wraps them.
    importBankTemplate: (bankId, manifest, options) =>
      withTimeout("hindsight importBankTemplate", timeoutMs, (signal) =>
        rest.request(bankTemplateImportPath(bankId, options), {
          method: "POST",
          signal,
          body: JSON.stringify(manifest),
        }),
      ),
    exportBankTemplate: (bankId) =>
      withTimeout(
        "hindsight exportBankTemplate",
        timeoutMs,
        async (signal) =>
          (await rest.request(bankTemplateExportPath(bankId), {
            signal,
          })) as import("./bank-template-catalog.js").BankTemplateManifest,
      ),
    getBankTemplateSchema: () =>
      withTimeout("hindsight getBankTemplateSchema", timeoutMs, (signal) =>
        rest.request(bankTemplateSchemaPath(), { signal }),
      ),
    // Use direct OpenAPI REST paths for directives so list filters (tags_match, active_only,
    // limit, offset) and nullable update fields stay aligned with server behavior.
    listDirectives: (bankId, options) =>
      withTimeout("hindsight listDirectives", timeoutMs, (signal) =>
        rest.request(directivesCollectionPath(bankId, options), { signal }),
      ),
    getDirective: (bankId, directiveId) =>
      withTimeout("hindsight getDirective", timeoutMs, (signal) =>
        rest.request(directiveItemPath(bankId, directiveId), { signal }),
      ),
    createDirective: (bankId, request) =>
      withTimeout("hindsight createDirective", timeoutMs, (signal) =>
        rest.request(directivesCollectionPath(bankId), {
          method: "POST",
          signal,
          body: JSON.stringify(createDirectiveRequestBody(request)),
        }),
      ),
    updateDirective: (bankId, directiveId, request) =>
      withTimeout("hindsight updateDirective", timeoutMs, (signal) =>
        rest.request(directiveItemPath(bankId, directiveId), {
          method: "PATCH",
          signal,
          body: JSON.stringify(updateDirectiveRequestBody(request)),
        }),
      ),
    deleteDirective: (bankId, directiveId) =>
      withTimeout("hindsight deleteDirective", timeoutMs, (signal) =>
        rest.request(directiveItemPath(bankId, directiveId), { method: "DELETE", signal }),
      ),
    listMentalModels: (bankId, options) =>
      withTimeout("hindsight listMentalModels", timeoutMs, (signal) =>
        rest.request(mentalModelCollectionPath(bankId, options), { signal }),
      ),
    getMentalModel: (bankId, mentalModelId, options) =>
      withTimeout("hindsight getMentalModel", timeoutMs, (signal) =>
        rest.request(mentalModelItemPath(bankId, mentalModelId, options), { signal }),
      ),
    createMentalModel: (bankId, request) =>
      withTimeout("hindsight createMentalModel", timeoutMs, (signal) =>
        rest.request(mentalModelCollectionPath(bankId), {
          method: "POST",
          signal,
          body: JSON.stringify(createMentalModelRequestBody(request)),
        }),
      ),
    updateMentalModel: (bankId, mentalModelId, request) =>
      withTimeout("hindsight updateMentalModel", timeoutMs, (signal) =>
        rest.request(mentalModelItemPath(bankId, mentalModelId), {
          method: "PATCH",
          signal,
          body: JSON.stringify(updateMentalModelRequestBody(request)),
        }),
      ),
    deleteMentalModel: (bankId, mentalModelId) =>
      withTimeout("hindsight deleteMentalModel", timeoutMs, (signal) =>
        rest.request(mentalModelItemPath(bankId, mentalModelId), { method: "DELETE", signal }),
      ),
    getMentalModelHistory: (bankId, mentalModelId) =>
      withTimeout("hindsight getMentalModelHistory", timeoutMs, (signal) =>
        rest.request(mentalModelHistoryPath(bankId, mentalModelId), { signal }),
      ),
    refreshMentalModel: (bankId, mentalModelId) =>
      withTimeout("hindsight refreshMentalModel", timeoutMs, (signal) =>
        rest.request(mentalModelRefreshPath(bankId, mentalModelId), { method: "POST", signal }),
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
