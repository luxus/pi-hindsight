import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { recallForContext } from "../extensions/lifecycle/recall.js";
import { createRecallTurnPolicy } from "../extensions/lifecycle/memory-lifecycle-recall.js";
import {
  emitRetrieval,
  telemetryEvent,
  type RetrievalTelemetry,
} from "../extensions/lifecycle/retrieval-telemetry.js";
import { createRecallOperations } from "../extensions/operations/memory-recall-operations.js";
const dirs: string[] = [];
afterEach(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "telemetry-"));
  dirs.push(cwd);
  mkdirSync(join(cwd, ".git"));
  const config = structuredClone(DEFAULT_CONFIG);
  config.recall.topK = 1;
  config.recall.includeDateInQuery = false;
  config.recall.includeRepoHintsInQuery = false;
  config.recall.storeLastRecall = false;
  const results = [
    { id: "a", text: "alpha", tags: ["x"] },
    { id: "dup", text: "alpha" },
    { text: "beta" },
    { id: "c", text: "gamma" },
  ];
  const recall = vi.fn(async (_bank: string, _query: string, _options: unknown) => ({ results }));
  const client = { recall } as never;
  const messages = [{ role: "user" as const, content: "exact request", timestamp: 1 }];
  const events: RetrievalTelemetry[] = [];
  const observer = (event: RetrievalTelemetry) => {
    events.push(event);
  };
  return { cwd, config, results, recall, client, messages, events, observer };
}
it("records exact scope query/filter/raw, quality-kept and topK IDs without changing return", async () => {
  const f = fixture();
  const scopes = [
    {
      bankId: "bank",
      kind: "project" as const,
      tagGroups: [{ tags: ["domain:x"], match: "all" as const }],
    },
  ];
  const args = { ...f, scopes };
  const before = await recallForContext({ ...args, observer: undefined });
  f.events.length = 0;
  const result = await recallForContext({ ...args, observer: f.observer });
  expect(result).toEqual(before);
  expect(f.events).toHaveLength(1);
  expect(f.events[0]).toMatchObject({
    version: 1,
    mode: "automatic",
    phase: "retrieval",
    cache: "miss",
    status: "success",
    bankId: "bank",
    query: f.recall.mock.calls[0]![1],
    tagGroups: scopes[0]!.tagGroups,
    rawIds: ["a", "dup", "c"],
    keptIds: ["a", "c"],
    injectedIds: ["a"],
    rawCount: 4,
    keptCount: 3,
    injectedCount: 1,
    results: [{ id: "a", tags: ["x"] }, { id: "dup" }, { id: "c" }],
  });
  expect(JSON.stringify(f.events[0])).not.toContain("alpha");
  expect(
    await recallForContext({
      ...args,
      observer: () => {
        throw new Error("observer");
      },
    }),
  ).toEqual(before);
  expect(
    await recallForContext({
      ...args,
      observer: async () => {
        throw new Error("observer");
      },
    }),
  ).toEqual(before);
});
it("cache hits emit bank events with origins, linked injection hashes and no extra HTTP", async () => {
  const f = fixture();
  const policy = createRecallTurnPolicy({
    getConfig: () => f.config,
    getClient: () => f.client,
    observer: f.observer,
    setMemoryStatus() {},
    notify() {},
  });
  const runtime = { cwd: f.cwd, ui: { setStatus() {}, notify() {} } };
  const patch = await policy.recall({ messages: f.messages }, runtime);
  const calls = f.recall.mock.calls.length;
  const original = f.events.filter((e) => e.phase === "retrieval");
  expect(original.length).toBeGreaterThan(0);
  f.events.length = 0;
  const cached = await policy.recall({ messages: f.messages }, runtime);
  expect(f.recall).toHaveBeenCalledTimes(calls);
  const hits = f.events.filter((e) => e.phase === "retrieval");
  expect(hits.map((e) => e.cacheOriginId)).toEqual(original.map((e) => e.retrievalId));
  expect(hits.every((e) => e.cache === "hit")).toBe(true);
  const rendered = cached!.messages.find(
    (m) => (m as { content?: unknown }).content !== "exact request",
  ) as { content?: unknown; role?: string; timestamp?: number } | undefined;
  const injection = f.events.find((e) => e.phase === "injection");
  expect(rendered).toBeDefined();
  expect(typeof rendered?.content).toBe("string");
  expect(injection).toMatchObject({
    injected: true,
    status: "success",
    renderedHash: createHash("sha256").update(String(rendered?.content)).digest("hex"),
    renderedLength: String(rendered?.content).length,
    retrievalIds: hits.map((e) => e.retrievalId),
  });
  expect(hits.every((e) => e.contextId === injection?.contextId)).toBe(true);
  expect(Object.keys(rendered ?? {}).sort()).toEqual(["content", "role", "timestamp"]);
  expect((patch!.messages[0] as { content?: unknown }).content).toEqual(
    (cached!.messages[0] as { content?: unknown }).content,
  );
});
it("reports outer scope timeout once even if HTTP later succeeds, plus error and empty", async () => {
  const f = fixture();
  f.config.recall.timeoutMs = 5;
  let resolve!: (value: unknown) => void;
  const client = {
    recall: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockRejectedValueOnce(new Error("broken"))
      .mockResolvedValueOnce({ results: [] }),
  } as never;
  const result = await recallForContext({
    ...f,
    client,
    observer: f.observer,
    scopes: ["slow", "bad", "empty"].map((bankId) => ({ bankId })),
  });
  expect(result.failed).toBe(2);
  expect(f.events.map((e) => e.status)).toEqual(["timeout", "error", "empty"]);
  resolve({ results: f.results });
  await Promise.resolve();
  expect(f.events).toHaveLength(3);
});
it("explicit recall records resolved options/results and rethrows same original error", async () => {
  const f = fixture();
  const ops = createRecallOperations({
    getConfig: () => f.config,
    getClient: () => f.client,
    getProjectBankId: () => "resolved",
    observer: f.observer,
  });
  const result = await ops.recall(f.cwd, "explicit exact", undefined, undefined, {
    tags: ["custom"],
    types: ["world"],
  });
  expect(result).toEqual({ bankId: "resolved", result: { results: f.results } });
  const event = f.events[0];
  expect(event).toMatchObject({
    mode: "explicit",
    bankId: "resolved",
    query: "explicit exact",
    cache: "none",
    rawIds: ["a", "dup", "c"],
    results: [{ id: "a", tags: ["x"] }, { id: "dup" }, { id: "c" }],
  });
  expect(event?.filters).toEqual(f.recall.mock.calls[0]![2]);
  const error = new Error("original");
  f.recall.mockRejectedValueOnce(error as never);
  await expect(ops.recall(f.cwd, "failure")).rejects.toBe(error);
  expect(f.events[1]?.status).toBe("error");
});
it("redacts secrets in query and never emits recalled text", () => {
  const events: RetrievalTelemetry[] = [];
  emitRetrieval(
    (event) => {
      events.push(event);
    },
    () =>
      telemetryEvent(Date.now(), {
        phase: "retrieval",
        mode: "explicit",
        cache: "none",
        status: "success",
        query: "token sk-abcdefghijklmnopqrstuv",
        results: [{ id: "a", text: "secret memory" }] as never,
      }),
  );
  expect(events[0]?.query).toContain("[REDACTED_API_KEY]");
  expect(JSON.stringify(events[0])).not.toContain("secret memory");
  expect(JSON.stringify(events[0])).not.toContain("sk-abcdefghijklmnopqrstuv");
});
it("distinguishes skipped and empty injection and isolates throwing observer", async () => {
  const f = fixture();
  f.config.recall.enabled = false;
  const deps = {
    getConfig: () => f.config,
    getClient: () => f.client,
    observer: f.observer,
    setMemoryStatus() {},
    notify() {},
  };
  const runtime = { cwd: f.cwd, ui: { setStatus() {}, notify() {} } };
  expect(
    await createRecallTurnPolicy(deps).recall({ messages: f.messages }, runtime),
  ).toBeUndefined();
  expect(f.events[0]).toMatchObject({ phase: "injection", status: "skipped", injected: false });
  f.config.recall.enabled = true;
  f.recall.mockResolvedValue({ results: [] });
  f.events.length = 0;
  expect(
    await createRecallTurnPolicy(deps).recall({ messages: f.messages }, runtime),
  ).toBeUndefined();
  expect(f.events.at(-1)).toMatchObject({ phase: "injection", status: "empty", injected: false });
  expect(
    await createRecallTurnPolicy({
      ...deps,
      observer() {
        throw new Error("export");
      },
    }).recall({ messages: f.messages }, runtime),
  ).toBeUndefined();
});
