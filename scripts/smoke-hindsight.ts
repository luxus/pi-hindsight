#!/usr/bin/env node
import { mkdtempSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { createHindsightClient } from "../extensions/client.js";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
import { operationIdsFromResponse } from "../extensions/queue-delivery.js";
import {
  cleanupSmokeBankOnSuccess,
  createSmokeRecorder,
  renderSmokeSummary,
  retry,
  smokeConfig,
  smokeMarker,
  writeGitHubSummary,
} from "./smoke-helpers.js";

const config = smokeConfig();
const marker = smokeMarker();
const adapterMarker = smokeMarker();
const operationsMarker = smokeMarker();
const importMarker = smokeMarker();
const importKeptToolMarker = smokeMarker();
const importNoiseMarker = smokeMarker();
const operationsCwd = mkdtempSync(join(tmpdir(), "pi-hindsight-smoke-ops-"));
mkdirSync(join(operationsCwd, ".git"));
const recorder = createSmokeRecorder();
let succeeded = false;

const client = new HindsightClient({
  baseUrl: config.baseUrl,
  ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  userAgent: "pi-hindsight-smoke/0.1.0",
});
const smokeExtensionConfig = {
  ...DEFAULT_CONFIG,
  hindsight: {
    ...DEFAULT_CONFIG.hindsight,
    baseUrl: config.baseUrl,
    timeoutMs: 90_000,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  },
  recall: {
    ...DEFAULT_CONFIG.recall,
    budget: "low" as const,
  },
  import: {
    ...DEFAULT_CONFIG.import,
    qualityProfile: "strict" as const,
    toolResults: "summary" as const,
    toolResultSummaryMaxChars: 120,
  },
};
const adapter = createHindsightClient(smokeExtensionConfig);
const operations = createMemoryOperations({
  getClient: () => adapter,
  getConfig: () => smokeExtensionConfig,
  getProjectBankId: () => config.bankId,
});

function capabilityErrorMessage(
  error: unknown,
  { endpointProbe = false }: { endpointProbe?: boolean } = {},
) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /does not support|is unavailable in this client|delete document is unavailable|405|501|not implemented|capability/i.test(
      message,
    )
  )
    return message;
  if (endpointProbe && /not found|404/i.test(message)) return message;
  return null;
}

async function capabilityStep(
  name: string,
  fn: () => Promise<Record<string, unknown> | void>,
  options: { allowSkip?: boolean; endpointProbe?: boolean } = {},
) {
  try {
    const data = (await fn()) ?? {};
    recorder.step(`${name}_ok`, data);
    return { ok: true };
  } catch (error) {
    const capabilityError = options.allowSkip ? capabilityErrorMessage(error, options) : null;
    if (capabilityError) {
      recorder.step(`${name}_skipped`, { reason: capabilityError.slice(0, 300) });
      return { ok: false, skipped: true };
    }
    throw error;
  }
}

function recordItems(value: unknown): unknown[] {
  if (typeof value !== "object" || !value) return [];
  if ("items" in value && Array.isArray(value.items)) return value.items;
  if ("results" in value && Array.isArray(value.results)) return value.results;
  if ("operations" in value && Array.isArray(value.operations)) return value.operations;
  if ("memories" in value && Array.isArray(value.memories)) return value.memories;
  if ("documents" in value && Array.isArray(value.documents)) return value.documents;
  return [];
}

function fieldValue(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== "object" || !value) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw) return raw;
  }
  return undefined;
}

function collectStringsByKey(value: unknown, keys: Set<string>, found = new Set<string>()) {
  if (typeof value !== "object" || !value) return found;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof raw === "string" && raw) found.add(raw);
    if (typeof raw === "object" && raw) collectStringsByKey(raw, keys, found);
  }
  return found;
}

function chunkIds(value: unknown): string[] {
  return [
    ...collectStringsByKey(
      value,
      new Set(["chunk_id", "chunkId", "source_chunk_id", "sourceChunkId"]),
    ),
  ];
}

function successfulOperationStatus(status: string | undefined) {
  return status ? ["completed", "succeeded"].includes(status) : false;
}

async function waitForOperationTerminal(ids: string[]) {
  if (!ids.length) return { operationIds: [], operationTracking: "not-reported" };
  const result = await retry(
    async () => operations.listOperations({ options: { limit: 50 } }),
    (listResult) => {
      const items = recordItems(listResult.result);
      return ids.every((id) => {
        const item = items.find((candidate) =>
          ["id", "operation_id", "operationId"].some((key) => fieldValue(candidate, [key]) === id),
        );
        return item ? successfulOperationStatus(fieldValue(item, ["status"])) : false;
      });
    },
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) =>
        recorder.step("file_operation_terminal_wait", { attempt, delayMs, operationIds: ids }),
      failureMessage: ({ attempts, preview }) =>
        `file retain operation did not reach terminal status after ${attempts} attempts: ${preview}`,
    },
  );
  return {
    operationIds: ids,
    operationTracking: "completed",
    responsePreview: JSON.stringify(result.result).slice(0, 500),
  };
}

try {
  recorder.step("start", { baseUrl: config.baseUrl, bankId: config.bankId });
  await client.createBank(config.bankId, {
    name: config.bankId,
    reflectMission: "Smoke-test bank for Pi Hindsight extension development.",
    retainMission:
      "Retain exact smoke-test markers as durable facts. Preserve marker strings verbatim.",
    retainExtractionMode: "verbose",
    enableObservations: true,
  });
  recorder.step("bank_ok");

  const adapterHealth = adapter.health;
  const adapterCreateBank = adapter.createBank;
  const adapterGetBankProfile = adapter.getBankProfile;
  if (!adapterHealth || !adapterCreateBank || !adapterGetBankProfile) {
    throw new Error("adapter missing required smoke capabilities");
  }

  await adapterHealth();
  recorder.step("adapter_health_ok");
  await adapterCreateBank(config.bankId, {
    name: config.bankId,
    reflectMission: "Smoke-test bank for Pi Hindsight extension development.",
    retainMission:
      "Retain exact smoke-test markers as durable facts. Preserve marker strings verbatim.",
    retainExtractionMode: "verbose",
    enableObservations: true,
  });
  recorder.step("adapter_bank_ok");
  await adapterGetBankProfile(config.bankId);
  recorder.step("adapter_profile_ok");

  await client.retain(config.bankId, `Smoke marker: ${marker}`, {
    context: "Pi Hindsight smoke test",
    documentId: `pi-smoke:${marker}`,
    updateMode: "append",
    tags: ["source:pi", "test:smoke"],
    metadata: { marker },
  });
  recorder.step("retain_ok", { marker });

  const recall = await retry(
    async () =>
      client.recall(config.bankId, marker, {
        budget: "mid",
        maxTokens: 1000,
        tags: ["test:smoke"],
        tagsMatch: "any_strict",
      }),
    (result) => JSON.stringify(result).includes(marker),
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) => recorder.step("recall_wait", { attempt, delayMs }),
      failureMessage: ({ attempts, preview }) =>
        `recall did not contain retained marker after ${attempts} attempts: ${preview}`,
    },
  );
  recorder.step("recall_ok", { containsMarker: JSON.stringify(recall).includes(marker) });

  const reflection = await client.reflect(
    config.bankId,
    `What smoke marker was retained? ${marker}`,
    {
      budget: "low",
      tags: ["test:smoke"],
      tagsMatch: "any_strict",
    },
  );
  recorder.step("reflect_ok", { responsePreview: JSON.stringify(reflection).slice(0, 300) });

  await adapter.retain(config.bankId, `Adapter smoke marker: ${adapterMarker}`, {
    context: "Pi Hindsight adapter smoke test",
    documentId: `pi-smoke-adapter:${adapterMarker}`,
    updateMode: "append",
    tags: ["source:pi", "test:smoke", "test:adapter"],
    metadata: { marker: adapterMarker },
  });
  recorder.step("adapter_retain_ok", { marker: adapterMarker });

  const adapterRecall = await retry(
    async () =>
      adapter.recall(config.bankId, adapterMarker, {
        budget: "mid",
        maxTokens: 1000,
        tags: ["test:adapter"],
        tagsMatch: "any_strict",
      }),
    (result) => JSON.stringify(result).includes(adapterMarker),
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) => recorder.step("adapter_recall_wait", { attempt, delayMs }),
      failureMessage: ({ attempts, preview }) =>
        `adapter recall did not contain retained marker after ${attempts} attempts: ${preview}`,
    },
  );
  recorder.step("adapter_recall_ok", {
    containsMarker: JSON.stringify(adapterRecall).includes(adapterMarker),
  });

  const adapterReflection = await adapter.reflect(
    config.bankId,
    `Return the adapter smoke marker as JSON: ${adapterMarker}`,
    {
      budget: "low",
      tags: ["test:adapter"],
      tagsMatch: "any_strict",
      responseSchema: {
        type: "object",
        properties: { marker: { type: "string" } },
        required: ["marker"],
      },
    },
  );
  recorder.step("adapter_reflect_ok", {
    responsePreview: JSON.stringify(adapterReflection).slice(0, 300),
  });

  const operationsRetain = await operations.retainExplicit({
    cwd: operationsCwd,
    content: `Operations smoke marker: ${operationsMarker}`,
    context: "Pi Hindsight operations smoke test",
    bank: "project",
    tags: ["test:smoke", "test:operations"],
  });
  recorder.step("operations_retain_ok", {
    marker: operationsMarker,
    documentId: operationsRetain.documentId,
    sent: operationsRetain.sent,
    remaining: operationsRetain.remaining,
  });

  const operationsFlush = await operations.flush(operationsCwd);
  recorder.step("operations_flush_ok", {
    sent: operationsFlush.sent,
    remaining: operationsFlush.remaining,
  });

  const operationsRecall = await retry(
    async () => operations.recall(operationsCwd, operationsMarker, "project"),
    (result) => JSON.stringify(result).includes(operationsMarker),
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) =>
        recorder.step("operations_recall_wait", { attempt, delayMs }),
      failureMessage: ({ attempts, preview }) =>
        `operations recall did not contain retained marker after ${attempts} attempts: ${preview}`,
    },
  );
  recorder.step("operations_recall_ok", {
    containsMarker: JSON.stringify(operationsRecall).includes(operationsMarker),
  });

  const operationsReflection = await operations.reflect(
    operationsCwd,
    `Return the operations smoke marker as JSON: ${operationsMarker}`,
    "Pi Hindsight operations smoke test",
    "project",
    {
      type: "object",
      properties: { marker: { type: "string" } },
      required: ["marker"],
    },
  );
  recorder.step("operations_reflect_ok", {
    responsePreview: JSON.stringify(operationsReflection).slice(0, 300),
  });

  const receipts = await operations.listRetainReceipts(operationsCwd, 5);
  const operationsReceipt = receipts.find(
    (receipt) =>
      receipt.bankId === config.bankId &&
      receipt.documentId === operationsRetain.documentId &&
      receipt.tags.includes("test:operations"),
  );
  if (!operationsReceipt) {
    throw new Error("operations retain receipt did not contain retained marker document");
  }
  recorder.step("operations_receipts_ok", { count: receipts.length });

  const smokeTextFile = join(operationsCwd, "smoke-file.txt");
  const fileMarker = smokeMarker();
  await writeFile(smokeTextFile, `File retain smoke marker: ${fileMarker}\n`, "utf8");
  let fileRetainResult: Awaited<ReturnType<typeof operations.retainFiles>> | undefined;
  const fileRetainCapability = await capabilityStep(
    "file_retain_capability",
    async () => {
      fileRetainResult = await operations.retainFiles({
        cwd: operationsCwd,
        files: [{ path: smokeTextFile, context: "Pi Hindsight smoke file retain" }],
        context: "Pi Hindsight smoke file retain",
        tags: ["test:smoke", "test:file-retain"],
      });
      return { responsePreview: JSON.stringify(fileRetainResult).slice(0, 500) };
    },
    { allowSkip: true, endpointProbe: true },
  );
  if (fileRetainCapability.ok) {
    if (!fileRetainResult)
      throw new Error("file retain result missing after successful retainFiles");
    const ids = operationIdsFromResponse(fileRetainResult.result);
    const operationTracking = await capabilityStep(
      "file_operation_tracking",
      async () => waitForOperationTerminal(ids),
      { allowSkip: true, endpointProbe: true },
    );
    recorder.step("file_retain_ok", {
      operationIds: ids,
      operationTracking: operationTracking.ok ? "checked-or-not-reported" : "unsupported",
      responsePreview: JSON.stringify(fileRetainResult).slice(0, 500),
    });
  }

  const directivesCapability = await capabilityStep(
    "directives_capability",
    async () => {
      await operations.listDirectives({ options: { limit: 1 } });
    },
    { allowSkip: true, endpointProbe: true },
  );
  if (directivesCapability.ok) {
    const directive = await operations.createDirective({
      request: {
        name: `Smoke directive ${operationsMarker}`,
        content: `Preserve smoke marker ${operationsMarker}.`,
        tags: ["test:smoke"],
        isActive: true,
      },
    });
    const directiveText = JSON.stringify(directive.result);
    const directiveId =
      typeof directive.result === "object" && directive.result && "id" in directive.result
        ? String(directive.result.id)
        : undefined;
    await operations.listDirectives({ options: { tags: ["test:smoke"], activeOnly: true } });
    if (directiveId) {
      await operations.getDirective({ directiveId });
      await operations.updateDirective({
        directiveId,
        request: { content: `Updated smoke marker ${operationsMarker}.` },
      });
      await operations.deleteDirective({ directiveId, confirm: true });
    }
    recorder.step("directives_ok", {
      directiveId: directiveId ?? "unknown",
      responsePreview: directiveText.slice(0, 300),
    });
  }

  const mentalModelsCapability = await capabilityStep(
    "mental_models_capability",
    async () => {
      await operations.listMentalModels({ options: { limit: 1 } });
    },
    { allowSkip: true, endpointProbe: true },
  );
  if (mentalModelsCapability.ok) {
    const model = await operations.createMentalModel({
      request: {
        name: `Smoke mental model ${operationsMarker}`,
        sourceQuery: `Summarize smoke marker ${operationsMarker}`,
        tags: ["test:smoke"],
      },
    });
    const modelText = JSON.stringify(model.result);
    const modelId =
      typeof model.result === "object" && model.result && "id" in model.result
        ? String(model.result.id)
        : undefined;
    await operations.listMentalModels({ options: { tags: ["test:smoke"] } });
    if (modelId) {
      await operations.getMentalModel({ mentalModelId: modelId });
      await capabilityStep(
        "mental_model_history",
        async () => {
          await operations.getMentalModelHistory({ mentalModelId: modelId });
        },
        { allowSkip: true, endpointProbe: true },
      );
      await capabilityStep(
        "mental_model_refresh",
        async () => {
          await operations.refreshMentalModel({ mentalModelId: modelId });
        },
        { allowSkip: true, endpointProbe: true },
      );
      await operations.updateMentalModel({
        mentalModelId: modelId,
        request: { tags: ["test:smoke", "updated"] },
      });
      await operations.deleteMentalModel({ mentalModelId: modelId, confirm: true });
    }
    recorder.step("mental_models_ok", {
      mentalModelId: modelId ?? "unknown",
      responsePreview: modelText.slice(0, 300),
    });
  }

  const documentCapability = await capabilityStep(
    "document_inspection_capability",
    async () => {
      await operations.listDocuments({ options: { limit: 1 } });
    },
    { allowSkip: true, endpointProbe: true },
  );
  if (documentCapability.ok) {
    const disposableDocumentId = `pi-smoke-delete:${operationsMarker}`;
    await operations.retainExplicit({
      cwd: operationsCwd,
      content: `Disposable document smoke marker: ${operationsMarker}`,
      context: "Pi Hindsight disposable document smoke test",
      bank: "project",
      documentId: disposableDocumentId,
      tags: ["test:smoke", "test:document-delete"],
      async: false,
    });
    await operations.flush(operationsCwd);
    await operations.listDocuments({ options: { q: operationsMarker, limit: 5 } });
    const document = await operations.getDocument({ documentId: operationsRetain.documentId });
    const chunks = chunkIds(document.result);
    if (chunks[0]) await operations.getChunk({ chunkId: chunks[0] });
    await operations.updateDocumentTags({
      documentId: operationsRetain.documentId,
      request: { tags: ["source:pi", "test:smoke", "test:operations", "test:document-update"] },
      confirm: true,
    });
    await operations.getDocument({ documentId: disposableDocumentId });
    await operations.deleteDocument({
      bank: "project",
      documentId: disposableDocumentId,
      confirm: true,
    });
    let deleteVerified = false;
    try {
      await operations.getDocument({ documentId: disposableDocumentId });
    } catch (error) {
      if (/not found|404/i.test(error instanceof Error ? error.message : String(error))) {
        deleteVerified = true;
      } else {
        throw error;
      }
    }
    if (!deleteVerified) throw new Error("deleted document remained fetchable");
    recorder.step("document_inspection_ok", {
      documentId: operationsRetain.documentId,
      deletedDocumentId: disposableDocumentId,
      deleteVerified,
      chunkId: chunks[0] ?? "none",
    });
  }

  await capabilityStep(
    "operations_list",
    async () => {
      const result = await operations.listOperations({ options: { limit: 5 } });
      return { responsePreview: JSON.stringify(result.result).slice(0, 500) };
    },
    { allowSkip: true, endpointProbe: true },
  );

  const memoryCapability = await capabilityStep(
    "memory_inspection_capability",
    async () => {
      await operations.listMemories({ options: { limit: 1 } });
    },
    { allowSkip: true, endpointProbe: true },
  );
  if (memoryCapability.ok) {
    const result = await retry(
      async () => operations.listMemories({ options: { q: operationsMarker, limit: 5 } }),
      (listResult) => recordItems(listResult.result).length > 0,
      {
        attempts: config.attempts,
        delayMs: 2000,
        onWait: ({ attempt, delayMs }) => recorder.step("memory_list_wait", { attempt, delayMs }),
        failureMessage: ({ attempts, preview }) =>
          `memory inspection did not find retained marker after ${attempts} attempts: ${preview}`,
      },
    );
    const items = recordItems(result.result);
    const first = items[0];
    const memoryId = fieldValue(first, ["id", "memory_id", "memoryId"]);
    if (!memoryId) throw new Error("memory inspection returned item without memory ID");
    const memory = await operations.getMemory({ memoryId });
    const chunks = [...chunkIds(memory.result), ...chunkIds(first)];
    if (!chunks[0]) throw new Error("memory inspection returned no chunk ID to fetch");
    await operations.getChunk({ chunkId: chunks[0] });
    await capabilityStep(
      "memory_history",
      async () => {
        await operations.getMemoryHistory({ memoryId });
      },
      { allowSkip: true, endpointProbe: true },
    );
    if (config.bankIsTemporary) {
      await operations.deleteMemoryObservations({ memoryId, confirm: true });
    } else {
      recorder.step("delete_memory_observations_skipped", { reason: "configured_bank", memoryId });
    }
    recorder.step("memory_inspection_ok", {
      memoryId,
      chunkId: chunks[0],
      count: items.length,
      deletedObservations: config.bankIsTemporary,
    });
  }

  const importSessionFile = join(operationsCwd, "smoke-import.jsonl");
  await writeFile(
    importSessionFile,
    [
      JSON.stringify({
        type: "session",
        id: `smoke-import-${importMarker}`,
        cwd: operationsCwd,
        timestamp: "2026-05-03T00:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-05-03T00:00:01.000Z",
        message: { role: "user", content: `Import smoke marker: ${importMarker}` },
      }),
      JSON.stringify({
        type: "message",
        id: "kept-tool",
        parentId: "root",
        timestamp: "2026-05-03T00:00:02.000Z",
        message: {
          role: "toolResult",
          name: "bash",
          content: `Strict import kept lightweight tool marker: ${importKeptToolMarker}`,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "noise-tool",
        parentId: "kept-tool",
        timestamp: "2026-05-03T00:00:03.000Z",
        message: {
          role: "toolResult",
          name: "process",
          content: `Refreshing smoke watcher status; strict import should drop ${importNoiseMarker}`,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "leaf",
        parentId: "noise-tool",
        timestamp: "2026-05-03T00:00:04.000Z",
        message: { role: "assistant", content: `Imported marker acknowledged: ${importMarker}` },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const importDryRun = await operations.importSession({
    sessionFile: importSessionFile,
    cwd: operationsCwd,
    bank: "project",
    dryRun: true,
  });
  const importDryRunDocument = importDryRun.documents[0];
  if (importDryRun.retained || importDryRun.documents.length !== 1 || !importDryRunDocument) {
    throw new Error("import dry-run did not preview exactly one unwritten document");
  }
  if (
    importDryRunDocument.importMode !== "curated" ||
    importDryRunDocument.importQualityProfile !== "strict" ||
    importDryRunDocument.projectedMessageCount !== 3 ||
    importDryRunDocument.droppedToolResultCount !== 1 ||
    importDryRunDocument.classificationReasonCounts?.["process-noise"] !== 1
  ) {
    throw new Error(
      `strict import dry-run metrics were unexpected: ${JSON.stringify(importDryRunDocument).slice(0, 1000)}`,
    );
  }
  recorder.step("import_dry_run_ok", {
    documentCount: importDryRun.documents.length,
    messageCount: importDryRun.messageCount,
    importQualityProfile: importDryRunDocument.importQualityProfile,
    projectedMessageCount: importDryRunDocument.projectedMessageCount,
    droppedToolResultCount: importDryRunDocument.droppedToolResultCount,
  });

  const importResult = await operations.importSession({
    sessionFile: importSessionFile,
    cwd: operationsCwd,
    bank: "project",
    dryRun: false,
  });
  const importedDocument = importResult.documents[0];
  if (
    !importResult.retained ||
    !importedDocument ||
    importedDocument.status !== "completed" ||
    importedDocument.importQualityProfile !== "strict" ||
    importedDocument.droppedToolResultCount !== 1
  ) {
    throw new Error("strict import smoke did not complete expected retained document");
  }
  recorder.step("import_ok", {
    documentId: importedDocument.documentId,
    messageCount: importResult.messageCount,
    importQualityProfile: importedDocument.importQualityProfile,
    droppedToolResultCount: importedDocument.droppedToolResultCount,
  });

  const importRecall = await retry(
    async () => operations.recall(operationsCwd, importMarker, "project"),
    (result) => {
      const text = JSON.stringify(result);
      return (
        text.includes(importMarker) &&
        text.includes(importKeptToolMarker) &&
        !text.includes(importNoiseMarker)
      );
    },
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) => recorder.step("import_recall_wait", { attempt, delayMs }),
      failureMessage: ({ attempts, preview }) =>
        `strict import recall did not contain kept markers without dropped noise after ${attempts} attempts: ${preview}`,
    },
  );
  const importRecallText = JSON.stringify(importRecall);
  recorder.step("import_recall_ok", {
    containsMarker: importRecallText.includes(importMarker),
    containsKeptToolMarker: importRecallText.includes(importKeptToolMarker),
    containsNoiseMarker: importRecallText.includes(importNoiseMarker),
  });
  if (!importRecallText.includes(importKeptToolMarker)) {
    throw new Error("strict import recall did not contain kept lightweight tool marker");
  }
  if (importRecallText.includes(importNoiseMarker)) {
    throw new Error("strict import recall contained dropped process-noise marker");
  }

  if (config.bankIsTemporary) {
    await capabilityStep(
      "clear_observations",
      async () => {
        const result = await operations.clearObservations({ confirm: true });
        return { responsePreview: JSON.stringify(result.result).slice(0, 300) };
      },
      { allowSkip: true, endpointProbe: true },
    );
  } else {
    recorder.step("clear_observations_skipped", { reason: "configured_bank" });
  }

  recorder.step("success", {
    bankId: config.bankId,
    marker,
    adapterMarker,
    operationsMarker,
    importMarker,
    importKeptToolMarker,
    importNoiseMarker,
  });
  succeeded = true;
} catch (error) {
  console.error(
    JSON.stringify({
      step: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await cleanupSmokeBankOnSuccess({ config, bankId: config.bankId, succeeded, recorder });
  const summary = await writeGitHubSummary(renderSmokeSummary(recorder.entries()));
  if (summary.error) recorder.step("summary_failed", { error: summary.error });
}
