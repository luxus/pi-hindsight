import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HindsightLikeClient } from "../../extensions/types.js";

export interface TranscriptMessageFixture {
  id: string;
  parentId?: string | null;
  message: Record<string, unknown>;
  timestamp?: string;
}

export interface WrittenTranscriptFixture {
  dir: string;
  sessionFile: string;
}

export function userMessage(id: string, content: string): TranscriptMessageFixture {
  return { id, message: { role: "user", content } };
}

export function assistantMessage(id: string, content: string): TranscriptMessageFixture {
  return { id, message: { role: "assistant", content } };
}

export function toolResult(
  id: string,
  name: string,
  content: string,
  options: { isError?: boolean } = {},
): TranscriptMessageFixture {
  return {
    id,
    message: {
      role: "toolResult",
      toolName: name,
      name,
      content,
      isError: Boolean(options.isError),
    },
  };
}

export function recalledMemoryBlock(id: string): TranscriptMessageFixture {
  return {
    id,
    message: {
      role: "assistant",
      customType: "hindsight-recall",
      content:
        "<hindsight-memory>previous retained fact that must not become source truth</hindsight-memory>",
    },
  };
}

export function processStatusNoise(id: string, content: string): Record<string, unknown> {
  return { type: "process-status", id, content };
}

export function progressNoise(id: string, content: string): Record<string, unknown> {
  return { type: "progress", id, content };
}

export function writePiTranscriptFixture(
  name: string,
  messages: TranscriptMessageFixture[],
  noise: Record<string, unknown>[] = [],
): WrittenTranscriptFixture {
  const dir = mkdtempSync(join(tmpdir(), `pi-hindsight-${name}-`));
  mkdirSync(join(dir, ".git"));
  const sessionFile = join(dir, "session.jsonl");
  const lines = [JSON.stringify({ type: "session", id: `${name}-session`, cwd: dir })];
  let previousId: string | null = null;
  for (const message of messages) {
    const parentId = message.parentId === undefined ? previousId : message.parentId;
    lines.push(
      JSON.stringify({
        type: "message",
        id: message.id,
        parentId,
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        message: message.message,
      }),
    );
    previousId = message.id;
  }
  for (const entry of noise) lines.push(JSON.stringify(entry));
  writeFileSync(sessionFile, lines.join("\n"));
  return { dir, sessionFile };
}

export function captureRetainClient(): HindsightLikeClient & {
  retained: Array<{ bankId: string; content: string; options: unknown }>;
} {
  const retained: Array<{ bankId: string; content: string; options: unknown }> = [];
  return {
    retained,
    retain: async (bankId, content, options) => {
      retained.push({ bankId, content, options });
    },
    recall: async () => [],
    reflect: async () => ({}),
  };
}

export function parsedRetainedMessages(content: string): Record<string, unknown>[] {
  const parsed = JSON.parse(content) as { messages?: Record<string, unknown>[] };
  return parsed.messages ?? [];
}
