interface JsonlEntry {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  parentSession?: unknown;
  message?: unknown;
}

export interface ParsedMessage {
  id?: string;
  parentId: string | null;
  timestamp?: string;
  data: Record<string, unknown>;
}

export interface ParsedSession {
  cwd?: string;
  sessionId?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  sessionTimestamp?: string;
  messages: ParsedMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function parentSessionInfo(value: unknown): { id?: string; file?: string } {
  if (typeof value === "string" && value.trim()) return { file: value };
  if (!isRecord(value)) return {};
  const id = stringField(value, ["id", "sessionId"]);
  const file = stringField(value, ["file", "path", "sessionFile"]);
  return { ...(id ? { id } : {}), ...(file ? { file } : {}) };
}

export function parseImportSessionJsonl(text: string): ParsedSession {
  const messages: ParsedMessage[] = [];
  let cwd: string | undefined;
  let sessionId: string | undefined;
  let parentSessionId: string | undefined;
  let parentSessionFile: string | undefined;
  let sessionTimestamp: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as JsonlEntry;
    if (entry.type === "session") {
      if (typeof entry.cwd === "string") cwd = entry.cwd;
      if (typeof entry.id === "string") sessionId = entry.id;
      const parent = parentSessionInfo(entry.parentSession);
      if (parent.id) parentSessionId = parent.id;
      if (parent.file) parentSessionFile = parent.file;
      if (typeof entry.timestamp === "string") sessionTimestamp = entry.timestamp;
    }
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    messages.push({
      ...(typeof entry.id === "string" ? { id: entry.id } : {}),
      parentId: entry.parentId ?? null,
      ...(typeof entry.timestamp === "string" ? { timestamp: entry.timestamp } : {}),
      data: {
        ...(typeof entry.id === "string" ? { id: entry.id } : {}),
        parentId: entry.parentId ?? null,
        ...(typeof entry.timestamp === "string" ? { timestamp: entry.timestamp } : {}),
        ...entry.message,
      },
    });
  }
  return {
    ...(cwd ? { cwd } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(parentSessionFile ? { parentSessionFile } : {}),
    ...(sessionTimestamp ? { sessionTimestamp } : {}),
    messages,
  };
}

export function parsePiSessionJsonl(text: string): {
  cwd?: string;
  messages: Record<string, unknown>[];
} {
  const parsed = parseImportSessionJsonl(text);
  return {
    ...(parsed.cwd ? { cwd: parsed.cwd } : {}),
    messages: parsed.messages.map((message) => message.data),
  };
}
