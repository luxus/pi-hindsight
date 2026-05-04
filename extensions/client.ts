import { HindsightClient } from "@vectorize-io/hindsight-client";
import { redactError } from "./sanitize.js";
import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import {
  assertHealthResponse,
  assertReflectResponse,
  createHindsightRestTransport,
  encodeBankPath,
  reflectRequestBody,
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
  if (!args.options?.responseSchema) return args.raw.reflect(args.bankId, args.query, args.options);
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
      withTimeout("hindsight retain", timeoutMs, () =>
        raw.retainBatch(
          bankId,
          [retainBatchItem(content, options)],
          options?.async !== undefined ? { async: options.async } : {},
        ),
      ),
    retainBatch: (...args) =>
      withTimeout("hindsight retainBatch", timeoutMs, () => raw.retainBatch(...args)),
    recall: (...args) => withTimeout("hindsight recall", timeoutMs, () => raw.recall(...args)),
    reflect: (bankId, query, options) =>
      withTimeout("hindsight reflect", timeoutMs, (signal) =>
        reflect({ raw, rest, bankId, query, options }, signal),
      ),
    createBank: (...args) =>
      withTimeout("hindsight createBank", timeoutMs, () => raw.createBank(...args)),
    getBankProfile: (...args) =>
      withTimeout("hindsight getBankProfile", timeoutMs, () => raw.getBankProfile(...args)),
    getBankStats: (bankId) =>
      withTimeout("hindsight getBankStats", timeoutMs, (signal) =>
        rest.request(encodeBankPath(bankId, "/stats"), { signal }),
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
    importBankTemplate: (bankId, manifest, options) =>
      withTimeout("hindsight importBankTemplate", timeoutMs, (signal) =>
        rest.request(
          `${encodeBankPath(bankId, "/import")}${options?.dryRun ? "?dry_run=true" : ""}`,
          {
            method: "POST",
            signal,
            body: JSON.stringify(manifest),
          },
        ),
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
