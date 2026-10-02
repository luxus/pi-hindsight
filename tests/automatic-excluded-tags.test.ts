import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { normalizeConfig } from "../extensions/config/config-normalize.js";
import { createHindsightClient } from "../extensions/client/client.js";
import { createRecallTurnPolicy } from "../extensions/lifecycle/memory-lifecycle-recall.js";
import { readLastRecallSnapshot } from "../extensions/lifecycle/recall-visibility.js";
import { createRecallOperations } from "../extensions/operations/memory-recall-operations.js";
import {
  agentConfigView,
  pickAgentConfigPatch,
} from "../extensions/operations/memory-control-operations.js";
import { buildProjectConfigPatch } from "../extensions/config/config-writer.js";

let server: Server | undefined;
let cwd: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

it("defaults empty and exposes a typed operator patch without changing unrelated configuration", () => {
  expect(DEFAULT_CONFIG.recall.excludedTags).toEqual([]);
  const patch = pickAgentConfigPatch({ recallExcludedTags: ["source:example"] });
  expect(buildProjectConfigPatch(patch)).toEqual({ recall: { excludedTags: ["source:example"] } });
  expect(() => pickAgentConfigPatch({ recallExcludedTags: [42] })).toThrow("array of strings");
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    recall: { ...DEFAULT_CONFIG.recall, excludedTags: ["source:example", "source:example"] },
  });
  expect(agentConfigView(config).recallExcludedTags).toEqual(["source:example"]);
  expect(config.retain).toEqual(DEFAULT_CONFIG.retain);
  expect(config.observations).toEqual(DEFAULT_CONFIG.observations);
});

it("sends exclusions at the automatic HTTP boundary, separates cached scopes, and leaves explicit lookup available", async () => {
  cwd = mkdtempSync(join(tmpdir(), "hindsight-auto-filter-"));
  mkdirSync(join(cwd, ".git"));
  const requests: Record<string, unknown>[] = [];
  // Protocol fixture only: proves real adapter serialization, not native search quality.
  const source = {
    id: "source-1",
    document_id: "path-derived-doc",
    type: "world",
    text: "Original tentative passage.",
    tags: ["project:example", "source:example"],
    metadata: { source_path: "example.md" },
  };
  const observation = {
    id: "observation-1",
    type: "observation",
    text: "Attributed tentative observation.",
    tags: source.tags,
    source_fact_ids: [source.id],
  };
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body) as Record<string, unknown>;
    requests.push(payload);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ results: [source, observation], source_facts: { [source.id]: source } }),
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  let config = normalizeConfig({
    ...DEFAULT_CONFIG,
    setupComplete: true,
    scope: { ...DEFAULT_CONFIG.scope, projectId: "example", includeSharedObservations: false },
    hindsight: { ...DEFAULT_CONFIG.hindsight, baseUrl: `http://127.0.0.1:${address.port}` },
    banks: {
      ...DEFAULT_CONFIG.banks,
      project: { ...DEFAULT_CONFIG.banks.project, bankId: "test-bank" },
    },
    mentalModels: { ...DEFAULT_CONFIG.mentalModels, inject: false },
    recall: {
      ...DEFAULT_CONFIG.recall,
      types: ["world", "observation"],
      storeLastRecall: true,
      includeSourceFacts: true,
    },
  });
  const client = createHindsightClient(config);
  const policy = createRecallTurnPolicy({
    getConfig: () => config,
    getClient: () => client,
    setMemoryStatus: () => undefined,
    notify: () => undefined,
  });
  const event = {
    messages: [{ role: "user", content: "What did the original notes say?", timestamp: 1 }],
  } as never;
  const runtime = { cwd, ui: { setStatus: () => undefined, notify: () => undefined } };
  await policy.recall(event, runtime);
  await policy.recall(event, runtime);
  expect(requests).toHaveLength(1);
  const snapshot = await readLastRecallSnapshot(cwd, config.recall.lastRecallPath);
  expect(snapshot?.rendered).toContain('source: "example.md"');
  expect(snapshot?.rendered).toContain("evidence IDs: source-1");
  expect(snapshot?.blocks[0]?.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ document_id: source.document_id, metadata: source.metadata }),
      expect.objectContaining({ source_fact_ids: [source.id] }),
    ]),
  );
  config = { ...config, recall: { ...config.recall, excludedTags: ["source:example"] } };
  await policy.recall(event, runtime);
  expect(requests).toHaveLength(2);
  const originalGroups = requests[0]!.tag_groups as unknown[];
  expect(originalGroups).toEqual([
    expect.objectContaining({
      match: "any_strict",
      tags: expect.arrayContaining(["project:example"]),
    }),
  ]);
  expect(requests[1]!.tag_groups).toEqual([
    ...originalGroups,
    { not: { tags: ["source:example"], match: "any_strict" } },
  ]);
  expect(requests[1]!.types).toEqual(["world", "observation"]);
  expect(requests[1]!.max_tokens).toBe(DEFAULT_CONFIG.recall.maxTokens);
  const ops = createRecallOperations({
    getConfig: () => config,
    getClient: () => client,
    getProjectBankId: () => "test-bank",
  });
  const explicit = await ops.recall(cwd, "Find my original notes");
  expect(requests[2]!.tag_groups).toEqual(originalGroups);
  expect(explicit.result).toMatchObject({ results: [source, observation] });
  // A change to shared visibility also changes the effective compound scopes.
  config = { ...config, scope: { ...config.scope, includeSharedObservations: true } };
  await policy.recall(event, runtime);
  expect(requests).toHaveLength(4);
  expect(requests[3]!.tag_groups).toEqual([
    { or: [originalGroups[0], { tags: [], match: "exact" }] },
    { not: { tags: ["source:example"], match: "any_strict" } },
  ]);
});
