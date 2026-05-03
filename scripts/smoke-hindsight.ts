#!/usr/bin/env node
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { createHindsightClient } from "../extensions/client.js";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createMemoryOperations } from "../extensions/memory-operation-service.js";
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
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  },
};
const adapter = createHindsightClient(smokeExtensionConfig);
const operations = createMemoryOperations({
  getClient: () => adapter,
  getConfig: () => smokeExtensionConfig,
  getProjectBankId: () => config.bankId,
});

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

  recorder.step("success", { bankId: config.bankId, marker, adapterMarker, operationsMarker });
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
