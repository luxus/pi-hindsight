#!/usr/bin/env node
import { HindsightClient } from "@vectorize-io/hindsight-client";
import {
  cleanupSmokeBankOnSuccess,
  createSmokeRecorder,
  renderSmokeSummary,
  retry,
  smokeConfig,
  smokeMarker,
  writeGitHubSummary,
} from "./smoke-helpers.mjs";

const config = smokeConfig();
const marker = smokeMarker();
const recorder = createSmokeRecorder();
let succeeded = false;

const client = new HindsightClient({
  baseUrl: config.baseUrl,
  ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  userAgent: "pi-hindsight-smoke/0.1.0",
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
        includeSourceFacts: true,
        maxSourceFactsTokens: 2000,
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

  recorder.step("success", { bankId: config.bankId, marker });
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
