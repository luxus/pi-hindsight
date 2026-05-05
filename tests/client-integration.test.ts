import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHindsightClient } from "../extensions/client.js";
import { ensureProjectBank } from "../extensions/bank-operations.js";
import { DEFAULT_CONFIG } from "../extensions/config.js";

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: unknown;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : undefined);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("Hindsight client adapter integration", () => {
  let server: Server;
  let baseUrl: string;
  const requests: CapturedRequest[] = [];

  beforeEach(async () => {
    requests.length = 0;
    server = createServer(async (req, res) => {
      const body = await readBody(req);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.method === "GET" && req.url === "/v1/default/banks/test-bank/profile") {
        sendJson(res, 404, { detail: "not found" });
        return;
      }
      if (req.method === "PUT" && req.url === "/v1/default/banks/test-bank") {
        sendJson(res, 200, { bank_id: "test-bank" });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/memories") {
        sendJson(res, 200, { accepted: true });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/memories/recall") {
        sendJson(res, 200, { results: [{ text: "remembered fact" }] });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/reflect") {
        sendJson(res, 200, { text: "reflection" });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/import?dry_run=true") {
        sendJson(res, 200, { dry_run: true, config_applied: true });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/default/banks/test-bank/export") {
        sendJson(res, 200, { version: "1", bank: { retain_mission: "Exported" } });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/bank-template-schema") {
        sendJson(res, 200, { title: "BankTemplateManifest", properties: { version: {} } });
        return;
      }
      if (
        req.method === "GET" &&
        req.url ===
          "/v1/default/banks/test-bank/directives?tags=project&tags_match=all&active_only=false&limit=10&offset=1"
      ) {
        sendJson(res, 200, {
          items: [{ id: "directive-1", bank_id: "test-bank", name: "Rule", content: "Use facts." }],
        });
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/default/banks/test-bank/directives/directive-1"
      ) {
        sendJson(res, 200, {
          id: "directive-1",
          bank_id: "test-bank",
          name: "Rule",
          content: "Use facts.",
        });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/directives") {
        sendJson(res, 200, {
          id: "directive-2",
          bank_id: "test-bank",
          name: "New",
          content: "Be exact.",
        });
        return;
      }
      if (
        req.method === "PATCH" &&
        req.url === "/v1/default/banks/test-bank/directives/directive-2"
      ) {
        sendJson(res, 200, {
          id: "directive-2",
          bank_id: "test-bank",
          name: "New",
          content: "Updated.",
        });
        return;
      }
      if (
        req.method === "DELETE" &&
        req.url === "/v1/default/banks/test-bank/directives/directive-2"
      ) {
        sendJson(res, 200, { deleted: true });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/default/banks/test-bank/config") {
        sendJson(res, 200, { config: { retain_custom_instructions: "Read from db" } });
        return;
      }
      if (req.method === "PATCH" && req.url === "/v1/default/banks/test-bank/config") {
        sendJson(res, 200, { updated: true });
        return;
      }
      if (req.method === "DELETE" && req.url === "/v1/default/banks/test-bank/config") {
        sendJson(res, 200, { reset: true });
        return;
      }
      if (
        req.method === "GET" &&
        req.url ===
          "/v1/default/banks/test-bank/mental-models?tags=source%3Api&tags_match=all&detail=metadata&limit=10&offset=2"
      ) {
        sendJson(res, 200, { items: [{ id: "model-1", name: "Model" }] });
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/default/banks/test-bank/mental-models/model-1?detail=full"
      ) {
        sendJson(res, 200, { id: "model-1", name: "Model", content: "full" });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/default/banks/test-bank/mental-models") {
        sendJson(res, 202, { operation_id: "create-op", status: "queued" });
        return;
      }
      if (
        req.method === "PATCH" &&
        req.url === "/v1/default/banks/test-bank/mental-models/model-1"
      ) {
        sendJson(res, 200, { id: "model-1", name: "Updated" });
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/default/banks/test-bank/mental-models/model-1/history"
      ) {
        sendJson(res, 200, { items: [{ id: "v1" }] });
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/v1/default/banks/test-bank/mental-models/model-1/refresh"
      ) {
        sendJson(res, 202, { operation_id: "refresh-op", status: "queued" });
        return;
      }
      if (
        req.method === "DELETE" &&
        req.url === "/v1/default/banks/test-bank/mental-models/model-1"
      ) {
        sendJson(res, 200, { deleted: true });
        return;
      }
      sendJson(res, 404, { detail: `unexpected ${req.method} ${req.url}` });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("uses official client endpoints and Hindsight request fields", async () => {
    const client = createHindsightClient({
      ...DEFAULT_CONFIG,
      hindsight: { ...DEFAULT_CONFIG.hindsight, baseUrl },
    });

    await ensureProjectBank(client, "test-bank");
    await client.retain("test-bank", "raw content", {
      context: "ctx",
      tags: ["source:pi"],
      documentId: "pi-session:abc",
      updateMode: "append",
      async: true,
      metadata: { source: "test" },
      entities: [{ text: "Alice", type: "person" }],
    });
    await client.retain("test-bank", "scoped content", {
      context: "scoped ctx",
      tags: ["source:pi"],
      documentId: "pi-session:scoped",
      updateMode: "append",
      observationScopes: [["repo:abc"], ["bank:test-bank"]],
    });
    const recall = await client.recall("test-bank", "query", {
      tags: ["source:pi"],
      tagsMatch: "any_strict",
      maxTokens: 123,
      budget: "low",
      queryTimestamp: "2024-01-01T00:00:00Z",
    });
    const reflection = await client.reflect("test-bank", "query", {
      budget: "low",
      responseSchema: { type: "object", properties: { answer: { type: "string" } } },
    });
    const templateDryRun = await client.importBankTemplate?.(
      "test-bank",
      { version: "1", bank: { retain_mission: "Retain useful facts." } },
      { dryRun: true },
    );
    const exportedTemplate = await client.exportBankTemplate?.("test-bank");
    const bankTemplateSchema = await client.getBankTemplateSchema?.();
    const directives = await client.listDirectives?.("test-bank", {
      tags: ["project"],
      tagsMatch: "all",
      activeOnly: false,
      limit: 10,
      offset: 1,
    });
    const directive = await client.getDirective?.("test-bank", "directive-1");
    const createdDirective = await client.createDirective?.("test-bank", {
      name: "New",
      content: "Be exact.",
      priority: 3,
      isActive: true,
      tags: ["project"],
    });
    const updatedDirective = await client.updateDirective?.("test-bank", "directive-2", {
      content: "Updated.",
      tags: null,
    });
    const deletedDirective = await client.deleteDirective?.("test-bank", "directive-2");
    const bankConfig = await client.getBankConfig?.("test-bank");
    const bankConfigUpdate = await client.updateBankConfig?.("test-bank", {
      retain_custom_instructions: "Write to db",
    });
    const bankConfigReset = await client.resetBankConfig?.("test-bank");
    const models = await client.listMentalModels?.("test-bank", {
      tags: ["source:pi"],
      tagsMatch: "all",
      detail: "metadata",
      limit: 10,
      offset: 2,
    });
    const model = await client.getMentalModel?.("test-bank", "model-1", { detail: "full" });
    const createdModel = await client.createMentalModel?.("test-bank", {
      name: "Model",
      sourceQuery: "What should recur?",
      tags: ["source:pi"],
      maxTokens: 256,
    });
    const updatedModel = await client.updateMentalModel?.("test-bank", "model-1", {
      sourceQuery: "Updated query",
      tags: null,
    });
    const history = await client.getMentalModelHistory?.("test-bank", "model-1");
    const refreshed = await client.refreshMentalModel?.("test-bank", "model-1");
    const deleted = await client.deleteMentalModel?.("test-bank", "model-1");

    expect(recall).toEqual({ results: [{ text: "remembered fact" }] });
    expect(reflection).toEqual({ text: "reflection" });
    expect(templateDryRun).toEqual({ dry_run: true, config_applied: true });
    expect(exportedTemplate).toEqual({ version: "1", bank: { retain_mission: "Exported" } });
    expect(bankTemplateSchema).toEqual({
      title: "BankTemplateManifest",
      properties: { version: {} },
    });
    expect(directives).toEqual({
      items: [{ id: "directive-1", bank_id: "test-bank", name: "Rule", content: "Use facts." }],
    });
    expect(directive).toEqual({
      id: "directive-1",
      bank_id: "test-bank",
      name: "Rule",
      content: "Use facts.",
    });
    expect(createdDirective).toEqual({
      id: "directive-2",
      bank_id: "test-bank",
      name: "New",
      content: "Be exact.",
    });
    expect(updatedDirective).toEqual({
      id: "directive-2",
      bank_id: "test-bank",
      name: "New",
      content: "Updated.",
    });
    expect(deletedDirective).toEqual({ deleted: true });
    expect(bankConfig).toEqual({ config: { retain_custom_instructions: "Read from db" } });
    expect(bankConfigUpdate).toEqual({ updated: true });
    expect(bankConfigReset).toEqual({ reset: true });
    expect(models).toEqual({ items: [{ id: "model-1", name: "Model" }] });
    expect(model).toEqual({ id: "model-1", name: "Model", content: "full" });
    expect(createdModel).toEqual({ operation_id: "create-op", status: "queued" });
    expect(updatedModel).toEqual({ id: "model-1", name: "Updated" });
    expect(history).toEqual({ items: [{ id: "v1" }] });
    expect(refreshed).toEqual({ operation_id: "refresh-op", status: "queued" });
    expect(deleted).toEqual({ deleted: true });

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /v1/default/banks/test-bank/profile",
      "PUT /v1/default/banks/test-bank",
      "POST /v1/default/banks/test-bank/memories",
      "POST /v1/default/banks/test-bank/memories",
      "POST /v1/default/banks/test-bank/memories/recall",
      "POST /v1/default/banks/test-bank/reflect",
      "POST /v1/default/banks/test-bank/import?dry_run=true",
      "GET /v1/default/banks/test-bank/export",
      "GET /v1/bank-template-schema",
      "GET /v1/default/banks/test-bank/directives?tags=project&tags_match=all&active_only=false&limit=10&offset=1",
      "GET /v1/default/banks/test-bank/directives/directive-1",
      "POST /v1/default/banks/test-bank/directives",
      "PATCH /v1/default/banks/test-bank/directives/directive-2",
      "DELETE /v1/default/banks/test-bank/directives/directive-2",
      "GET /v1/default/banks/test-bank/config",
      "PATCH /v1/default/banks/test-bank/config",
      "DELETE /v1/default/banks/test-bank/config",
      "GET /v1/default/banks/test-bank/mental-models?tags=source%3Api&tags_match=all&detail=metadata&limit=10&offset=2",
      "GET /v1/default/banks/test-bank/mental-models/model-1?detail=full",
      "POST /v1/default/banks/test-bank/mental-models",
      "PATCH /v1/default/banks/test-bank/mental-models/model-1",
      "GET /v1/default/banks/test-bank/mental-models/model-1/history",
      "POST /v1/default/banks/test-bank/mental-models/model-1/refresh",
      "DELETE /v1/default/banks/test-bank/mental-models/model-1",
    ]);

    expect(requests[2]?.body).toMatchObject({
      items: [
        {
          content: "raw content",
          context: "ctx",
          document_id: "pi-session:abc",
          update_mode: "append",
          tags: ["source:pi"],
          metadata: { source: "test" },
          entities: [{ text: "Alice", type: "person" }],
        },
      ],
      async: true,
    });
    expect(JSON.stringify(requests[2]?.body)).not.toContain("observation_scopes");
    expect(requests[3]?.body).toMatchObject({
      items: [
        {
          content: "scoped content",
          context: "scoped ctx",
          document_id: "pi-session:scoped",
          update_mode: "append",
          tags: ["source:pi"],
          observation_scopes: [["repo:abc"], ["bank:test-bank"]],
        },
      ],
    });
    expect(JSON.stringify(requests[3]?.body)).not.toContain("observationScopes");
    expect(requests[4]?.body).toMatchObject({
      query: "query",
      max_tokens: 123,
      budget: "low",
      query_timestamp: "2024-01-01T00:00:00Z",
      tags: ["source:pi"],
      tags_match: "any_strict",
    });
    expect(requests[5]?.body).toMatchObject({
      query: "query",
      budget: "low",
      response_schema: { type: "object", properties: { answer: { type: "string" } } },
    });
    expect(requests[6]?.body).toEqual({
      version: "1",
      bank: { retain_mission: "Retain useful facts." },
    });
    expect(requests[11]?.body).toEqual({
      name: "New",
      content: "Be exact.",
      priority: 3,
      is_active: true,
      tags: ["project"],
    });
    expect(requests[12]?.body).toEqual({ content: "Updated.", tags: null });
    expect(requests[15]?.body).toEqual({
      updates: { retain_custom_instructions: "Write to db" },
    });
    expect(requests[19]?.body).toEqual({
      name: "Model",
      source_query: "What should recur?",
      tags: ["source:pi"],
      max_tokens: 256,
    });
    expect(requests[20]?.body).toEqual({ source_query: "Updated query", tags: null });
  });
});
