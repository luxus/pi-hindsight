import { HindsightClient } from "@vectorize-io/hindsight-client";
import { redactError } from "./sanitize.js";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { PI_HINDSIGHT_USER_AGENT } from "./version.js";
import {
  assertHealthResponse,
  assertReflectResponse,
  bankConfigPath,
  bankBackgroundPath,
  bankProfilePath,
  bankTemplateExportPath,
  bankTemplateImportPath,
  bankTemplateSchemaPath,
  chunkItemPath,
  consolidationPath,
  consolidationRecoverPath,
  createDirectiveRequestBody,
  createHindsightRestTransport,
  createMentalModelRequestBody,
  documentItemPath,
  documentsCollectionPath,
  directiveItemPath,
  directivesCollectionPath,
  encodeBankPath,
  entitiesCollectionPath,
  entityGraphPath,
  entityItemPath,
  entityRegeneratePath,
  graphPath,
  memoriesCollectionPath,
  memoryHistoryPath,
  memoryItemPath,
  memoryObservationsPath,
  mentalModelCollectionPath,
  mentalModelHistoryPath,
  mentalModelItemPath,
  mentalModelRefreshPath,
  operationCancelPath,
  operationRetryPath,
  operationsCollectionPath,
  observationsPath,
  reflectRequestBody,
  tagsCollectionPath,
  updateBankConfigRequestBody,
  updateBankProfileRequestBody,
  updateDirectiveRequestBody,
  updateDocumentRequestBody,
  updateMentalModelRequestBody,
} from "./client-rest.js";
import { withTimeout } from "./timeout.js";

type ReflectOptions = Parameters<HindsightLikeClient["reflect"]>[2];
type RetainOptions = Parameters<HindsightLikeClient["retain"]>[2];

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
    rest: ReturnType<typeof createHindsightRestTransport>;
    bankId: string;
    query: string;
    options: ReflectOptions;
  },
  signal: AbortSignal,
): Promise<unknown> {
  const needsRestShim =
    args.options?.responseSchema ||
    args.options?.maxTokens !== undefined ||
    args.options?.includeFacts !== undefined ||
    args.options?.includeToolCalls !== undefined;
  if (!needsRestShim) return args.raw.reflect(args.bankId, args.query, { ...args.options, signal });
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
    userAgent: PI_HINDSIGHT_USER_AGENT,
  });
  const rest = createHindsightRestTransport(config);
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
    retainFiles: (bankId, files, options) =>
      withTimeout(
        "hindsight retainFiles",
        timeoutMs,
        (signal) =>
          raw.retainFiles(bankId, files, {
            ...(options?.context ? { context: options.context } : {}),
            ...(options?.filesMetadata
              ? {
                  filesMetadata: options.filesMetadata.map((metadata) => ({
                    ...(metadata.context ? { context: metadata.context } : {}),
                    ...(metadata.documentId ? { document_id: metadata.documentId } : {}),
                    ...(metadata.tags ? { tags: metadata.tags } : {}),
                    ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
                  })),
                }
              : {}),
            signal,
          }),
        options?.signal,
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
    updateBankProfile: (bankId, request) =>
      withTimeout("hindsight updateBankProfile", timeoutMs, (signal) =>
        rest.request(encodeBankPath(bankId, ""), {
          method: "PATCH",
          signal,
          body: JSON.stringify(updateBankProfileRequestBody(request)),
        }),
      ),
    updateBankDisposition: (bankId, disposition) =>
      withTimeout("hindsight updateBankDisposition", timeoutMs, (signal) =>
        rest.request(bankProfilePath(bankId), {
          method: "PUT",
          signal,
          body: JSON.stringify({ disposition }),
        }),
      ),
    addBankBackground: (bankId, request) =>
      withTimeout("hindsight addBankBackground", timeoutMs, (signal) =>
        rest.request(bankBackgroundPath(bankId), {
          method: "POST",
          signal,
          body: JSON.stringify({
            content: request.content,
            ...(request.updateDisposition !== undefined
              ? { update_disposition: request.updateDisposition }
              : {}),
          }),
        }),
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
    listDocuments: (bankId, options) =>
      withTimeout("hindsight listDocuments", timeoutMs, (signal) =>
        rest.request(documentsCollectionPath(bankId, options), { signal }),
      ),
    getDocument: (bankId, documentId) =>
      withTimeout("hindsight getDocument", timeoutMs, (signal) =>
        rest.request(documentItemPath(bankId, documentId), { signal }),
      ),
    updateDocument: (bankId, documentId, request) =>
      withTimeout("hindsight updateDocument", timeoutMs, (signal) =>
        rest.request(documentItemPath(bankId, documentId), {
          method: "PATCH",
          signal,
          body: JSON.stringify(updateDocumentRequestBody(request)),
        }),
      ),
    deleteDocument: (bankId, documentId) =>
      withTimeout("hindsight deleteDocument", timeoutMs, (signal) =>
        rest.request(documentItemPath(bankId, documentId), { method: "DELETE", signal }),
      ),
    listEntities: (bankId, options) =>
      withTimeout("hindsight listEntities", timeoutMs, (signal) =>
        rest.request(entitiesCollectionPath(bankId, options), { signal }),
      ),
    getEntity: (bankId, entityId) =>
      withTimeout("hindsight getEntity", timeoutMs, (signal) =>
        rest.request(entityItemPath(bankId, entityId), { signal }),
      ),
    regenerateEntity: (bankId, entityId) =>
      withTimeout("hindsight regenerateEntity", timeoutMs, (signal) =>
        rest.request(entityRegeneratePath(bankId, entityId), { method: "POST", signal }),
      ),
    getGraph: (bankId, options) =>
      withTimeout("hindsight getGraph", timeoutMs, (signal) =>
        rest.request(graphPath(bankId, options), { signal }),
      ),
    getEntityGraph: (bankId, options) =>
      withTimeout("hindsight getEntityGraph", timeoutMs, (signal) =>
        rest.request(entityGraphPath(bankId, options), { signal }),
      ),
    listTags: (bankId, options) =>
      withTimeout("hindsight listTags", timeoutMs, (signal) =>
        rest.request(tagsCollectionPath(bankId, options), { signal }),
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
    triggerConsolidation: (bankId) =>
      withTimeout("hindsight triggerConsolidation", timeoutMs, (signal) =>
        rest.request(consolidationPath(bankId), { method: "POST", signal }),
      ),
    recoverConsolidation: (bankId) =>
      withTimeout("hindsight recoverConsolidation", timeoutMs, (signal) =>
        rest.request(consolidationRecoverPath(bankId), { method: "POST", signal }),
      ),
    clearObservations: (bankId) =>
      withTimeout("hindsight clearObservations", timeoutMs, (signal) =>
        rest.request(observationsPath(bankId), { method: "DELETE", signal }),
      ),
    listOperations: (bankId, options) =>
      withTimeout("hindsight listOperations", timeoutMs, (signal) =>
        rest.request(operationsCollectionPath(bankId, options), { signal }),
      ),
    cancelOperation: (bankId, operationId) =>
      withTimeout("hindsight cancelOperation", timeoutMs, (signal) =>
        rest.request(operationCancelPath(bankId, operationId), { method: "DELETE", signal }),
      ),
    retryOperation: (bankId, operationId) =>
      withTimeout("hindsight retryOperation", timeoutMs, (signal) =>
        rest.request(operationRetryPath(bankId, operationId), { method: "POST", signal }),
      ),
    listMemories: (bankId, options) =>
      withTimeout("hindsight listMemories", timeoutMs, (signal) =>
        rest.request(memoriesCollectionPath(bankId, options), { signal }),
      ),
    getMemory: (bankId, memoryId) =>
      withTimeout("hindsight getMemory", timeoutMs, (signal) =>
        rest.request(memoryItemPath(bankId, memoryId), { signal }),
      ),
    getChunk: (chunkId) =>
      withTimeout("hindsight getChunk", timeoutMs, (signal) =>
        rest.request(chunkItemPath(chunkId), { signal }),
      ),
    getMemoryHistory: (bankId, memoryId) =>
      withTimeout("hindsight getMemoryHistory", timeoutMs, (signal) =>
        rest.request(memoryHistoryPath(bankId, memoryId), { signal }),
      ),
    deleteMemoryObservations: (bankId, memoryId) =>
      withTimeout("hindsight deleteMemoryObservations", timeoutMs, (signal) =>
        rest.request(memoryObservationsPath(bankId, memoryId), { method: "DELETE", signal }),
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
