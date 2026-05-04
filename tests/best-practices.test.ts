import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { buildRetainJob } from "../extensions/retain.js";
import { selectMemoryScopes } from "../extensions/memory-scope.js";
import { importPiSession } from "../extensions/import-sessions.js";
import type { HindsightLikeClient, ResolvedConfig } from "../extensions/types.js";

function noopClient(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("Hindsight best-practice invariants", () => {
  it("retains raw structured conversation JSON with context, stable live document id, append mode, tags, and provenance metadata", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-best-practices-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    const messages = [
      {
        role: "user",
        content: "Decision: use append mode for live sessions.",
        timestamp: Date.UTC(2026, 3, 28, 10, 0, 0),
      },
      {
        role: "assistant",
        content: "Confirmed. Keep the same document id for this live session.",
        timestamp: Date.UTC(2026, 3, 28, 10, 1, 0),
      },
    ] as unknown as AgentEndEvent["messages"];

    const first = buildRetainJob({
      config: DEFAULT_CONFIG,
      cwd,
      sessionFile,
      bankId: "project-bank",
      messages,
    });
    const second = buildRetainJob({
      config: DEFAULT_CONFIG,
      cwd,
      sessionFile,
      bankId: "project-bank",
      messages,
    });

    expect(first?.documentId).toBe(second?.documentId);
    expect(first?.documentId).toMatch(/^pi-session:/);
    expect(first?.updateMode).toBe("append");
    expect(first?.item.context).toContain("Pi coding session");
    expect(first?.item.timestamp).toEqual(expect.any(String));
    expect(first?.item.tags).toEqual(
      expect.arrayContaining([
        "source:pi",
        expect.stringMatching(/^repo:/),
        expect.stringMatching(/^session:/),
      ]),
    );
    expect(first?.item.metadata).toMatchObject({
      cwd,
      imported: "false",
      pi_session_file: sessionFile,
    });

    const retained = JSON.parse(first?.item.content ?? "[]") as Array<Record<string, unknown>>;
    expect(retained).toHaveLength(2);
    expect(retained).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Decision: use append mode for live sessions.",
        timestamp: "2026-04-28T10:00:00.000Z",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Confirmed. Keep the same document id for this live session.",
        timestamp: "2026-04-28T10:01:00.000Z",
      }),
    ]);
    expect(first?.item.content).not.toContain("summary");
  });

  it("does not retain recalled memory blocks back into Hindsight", () => {
    const messages = [
      { role: "user", content: "What did we decide?", timestamp: 1 },
      {
        role: "user",
        content: "<hindsight-memory>Remembered secret project context</hindsight-memory>",
        timestamp: 2,
      },
      { role: "assistant", content: "We decided to keep recall ephemeral.", timestamp: 3 },
    ] as unknown as AgentEndEvent["messages"];

    const job = buildRetainJob({
      config: DEFAULT_CONFIG,
      cwd: "/repo",
      sessionFile: "/tmp/session.jsonl",
      bankId: "project-bank",
      messages,
    });

    expect(job?.item.content).toContain("What did we decide?");
    expect(job?.item.content).toContain("We decided to keep recall ephemeral.");
    expect(job?.item.content).not.toContain("<hindsight-memory>");
    expect(job?.item.content).not.toContain("Remembered secret project context");
  });

  it("uses strict tag-based recall scopes instead of metadata filtering", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-best-practices-"));
    mkdirSync(join(cwd, ".git"));
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      banks: { ...DEFAULT_CONFIG.banks, user: { enabled: true, bankId: "pi-global" } },
    };

    const scopes = selectMemoryScopes(cwd, config);

    expect(scopes).toEqual([
      expect.objectContaining({
        kind: "project",
        bankId: expect.stringMatching(/^pi-project-/),
        tags: [expect.stringMatching(/^repo:/)],
        tagsMatch: "any_strict",
      }),
      expect.objectContaining({
        kind: "global",
        bankId: "pi-global",
        tags: ["source:pi"],
        tagsMatch: "any_strict",
      }),
    ]);
    expect(JSON.stringify(scopes)).not.toContain("metadata");
  });

  it("uses deterministic replace documents for historical imports", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-best-practices-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          id: "session-import",
          cwd,
          timestamp: "2026-04-28T10:00:00.000Z",
        }),
        JSON.stringify({
          type: "message",
          id: "root",
          parentId: null,
          timestamp: "2026-04-28T10:01:00.000Z",
          message: { role: "user", content: "Import this exact branch." },
        }),
        JSON.stringify({
          type: "message",
          id: "leaf",
          parentId: "root",
          timestamp: "2026-04-28T10:02:00.000Z",
          message: { role: "assistant", content: "Use replace only for deterministic import." },
        }),
      ].join("\n"),
    );

    const first = await importPiSession({
      sessionFile,
      bankId: "project-bank",
      config: DEFAULT_CONFIG,
      client: noopClient(),
      dryRun: true,
    });
    const second = await importPiSession({
      sessionFile,
      bankId: "project-bank",
      config: DEFAULT_CONFIG,
      client: noopClient(),
      dryRun: true,
    });

    expect(first.documentId).toBe(
      "pi-import:session-import:leaf:leaf:turns-12-bytes-80000:curated-turns-v1:chunk-0-0-1",
    );
    expect(second.documentId).toBe(first.documentId);
    expect(first.documents[0]).toMatchObject({
      documentId: first.documentId,
      updateMode: "replace",
      wouldWrite: false,
      tags: expect.arrayContaining([
        "source:pi",
        "import:historical",
        "imported:true",
        "session:session-import",
        "branch:leaf",
      ]),
    });
    expect(first.documents[0]?.contentHash).toBe(second.documents[0]?.contentHash);
  });
});
