import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { importPiSession } from "../extensions/import-sessions.js";
import { recallForContext } from "../extensions/recall.js";
import type { HindsightLikeClient } from "../extensions/types.js";
import {
  assistantMessage,
  captureRetainClient,
  parsedRetainedMessages,
  recalledMemoryBlock,
  toolResult,
  userMessage,
  writePiTranscriptFixture,
} from "./helpers/memory-quality-fixtures.js";

function textField(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function recallClientFromImportedMessages(retained: {
  options: unknown;
  content: string;
}): HindsightLikeClient {
  const options = retained.options as { tags?: string[] };
  const messages = parsedRetainedMessages(retained.content);
  return {
    retain: async () => undefined,
    reflect: async () => ({}),
    recall: async (_bankId, _query, recallOptions) => {
      const tags = options.tags ?? [];
      const requestedTags = recallOptions?.tags ?? [];
      const matchesScope =
        requestedTags.length === 0 || requestedTags.some((tag) => tags.includes(tag));
      if (!matchesScope) return [];
      return messages.map((message) => ({
        text: `${textField(message.role)}: ${textField(message.content)}`,
        tags,
      }));
    },
  };
}

describe("import to recall roundtrip quality", () => {
  it("preserves durable signal through curated import and recall while excluding known noise", async () => {
    const fixture = writePiTranscriptFixture("roundtrip-quality", [
      userMessage("u1", "Fix retain queue race for issue #248."),
      toolResult("read1", "read", "huge source file output should not survive roundtrip"),
      toolResult("bash1", "bash", "npm test failed: expected 2 got 1", { isError: true }),
      assistantMessage(
        "a1",
        "Decision: keep queue-first retain behavior; PR #260 will add regression coverage.",
      ),
      recalledMemoryBlock("r1"),
    ]);
    const importClient = captureRetainClient();

    const imported = await importPiSession({
      sessionFile: fixture.sessionFile,
      bankId: "project-bank",
      config: DEFAULT_CONFIG,
      client: importClient,
    });
    const retained = importClient.retained[0]!;
    const importedTags = (retained.options as { tags?: string[] }).tags ?? [];
    const repoTag = importedTags.find((tag) => tag.startsWith("repo:"));
    expect(repoTag).toBeDefined();
    const recall = await recallForContext({
      client: recallClientFromImportedMessages(retained),
      config: DEFAULT_CONFIG,
      scopes: [
        { kind: "project", bankId: "project-bank", tags: [repoTag!], tagsMatch: "any_strict" },
      ],
      messages: [{ role: "user", content: "What happened with issue #248?" } as never],
      cwd: fixture.dir,
    });

    expect(imported.documents[0]).toMatchObject({
      rawMessageCount: 4,
      projectedMessageCount: 3,
      droppedToolResultCount: 1,
      keptToolErrorCount: 1,
    });
    expect(recall.rendered).toContain("Fix retain queue race for issue #248");
    expect(recall.rendered).toContain("npm test failed: expected 2 got 1");
    expect(recall.rendered).toContain("Decision: keep queue-first retain behavior");
    expect(recall.rendered).toContain("PR #260");
    expect(recall.rendered).not.toContain("huge source file output");
    expect(recall.rendered).not.toContain("previous retained fact");
    expect(recall.rendered).not.toContain("hindsight-recall");
  });
});
