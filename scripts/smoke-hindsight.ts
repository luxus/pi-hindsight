#!/usr/bin/env node
import { mkdtempSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { resolveBankExistence } from "../extensions/banks/bank-operations.js";
import { createHindsightClient } from "../extensions/client/client.js";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { createMemoryOperations } from "../extensions/operations/memory-operation-service.js";
import {
  cleanupSmokeBank,
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
    // Sync import retain under parallel CI can exceed 90s; leave headroom for load.
    timeoutMs: 180_000,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  },
  recall: {
    ...DEFAULT_CONFIG.recall,
    budget: "low" as const,
  },
  // Sync retain so import getDocument/recall see materialized content without waiting
  // on background operation completion (async retain left documents null for 40s+).
  retain: {
    ...DEFAULT_CONFIG.retain,
    async: false,
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
  const adapterListBanks = adapter.listBanks;
  if (!adapterHealth || !adapterCreateBank || !adapterListBanks) {
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
  const listed = await resolveBankExistence(adapter, config.bankId);
  if (listed !== true) {
    throw new Error(`adapter listBanks did not confirm exact bank_id ${config.bankId}`);
  }
  recorder.step("adapter_list_banks_ok");

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

  // Prove the retained import document text (not observation consolidation). Default
  // operations.recall is observation-only and has been timing out on imported JSON chats
  // since ~2026-07-31 while earlier ops observations win semantic search.
  const importDocumentId = importedDocument.documentId;
  if (!importDocumentId) throw new Error("strict import smoke missing retained documentId");
  const importDocument = await retry(
    async () => client.getDocument(config.bankId, importDocumentId),
    (result) => {
      const text = result?.original_text ?? "";
      return (
        text.includes(importMarker) &&
        text.includes(importKeptToolMarker) &&
        !text.includes(importNoiseMarker)
      );
    },
    {
      attempts: config.attempts,
      delayMs: 2000,
      onWait: ({ attempt, delayMs }) => recorder.step("import_document_wait", { attempt, delayMs }),
      failureMessage: ({ attempts, preview }) =>
        `strict import document did not contain kept markers without dropped noise after ${attempts} attempts: ${preview}`,
    },
  );
  const importDocumentText = importDocument?.original_text ?? "";
  recorder.step("import_document_ok", {
    documentId: importDocumentId,
    containsMarker: importDocumentText.includes(importMarker),
    containsKeptToolMarker: importDocumentText.includes(importKeptToolMarker),
    containsNoiseMarker: importDocumentText.includes(importNoiseMarker),
  });

  // Also prove extracted facts become recallable. Use the raw adapter (dedicated smoke
  // bank — no project tag AND) and include world/experience so we do not wait on
  // observation consolidation.
  const importRecall = await retry(
    async () =>
      adapter.recall(config.bankId, `${importMarker} ${importKeptToolMarker}`, {
        types: ["world", "experience", "observation"],
        preferObservations: false,
        budget: "mid",
        maxTokens: 2000,
      }),
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
  await cleanupSmokeBank({ config, bankId: config.bankId, succeeded, recorder });
  const summary = await writeGitHubSummary(renderSmokeSummary(recorder.entries()));
  if (summary.error) recorder.step("summary_failed", { error: summary.error });
}
