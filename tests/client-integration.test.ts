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

    expect(recall).toEqual({ results: [{ text: "remembered fact" }] });
    expect(reflection).toEqual({ text: "reflection" });

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "PUT /v1/default/banks/test-bank",
      "POST /v1/default/banks/test-bank/memories",
      "POST /v1/default/banks/test-bank/memories",
      "POST /v1/default/banks/test-bank/memories/recall",
      "POST /v1/default/banks/test-bank/reflect",
    ]);

    expect(requests[1]?.body).toMatchObject({
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
    expect(JSON.stringify(requests[1]?.body)).not.toContain("observation_scopes");
    expect(requests[2]?.body).toMatchObject({
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
    expect(JSON.stringify(requests[2]?.body)).not.toContain("observationScopes");
    expect(requests[3]?.body).toMatchObject({
      query: "query",
      max_tokens: 123,
      budget: "low",
      query_timestamp: "2024-01-01T00:00:00Z",
      tags: ["source:pi"],
      tags_match: "any_strict",
    });
    expect(requests[4]?.body).toMatchObject({
      query: "query",
      budget: "low",
      response_schema: { type: "object", properties: { answer: { type: "string" } } },
    });
  });
});
