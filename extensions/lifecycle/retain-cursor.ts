import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const RETAIN_CURSOR_VERSION = 3 as const;
export const RETAIN_CURSOR_TAIL_WINDOW = 200;

export interface SessionRetainCursor {
  index: number;
  chainHash: string;
  idChainHash: string;
  tailStart: number;
  messageIds: string[];
  fingerprints: string[];
}

export interface SessionRetainState {
  cursor?: SessionRetainCursor;
  legacyFingerprints?: Set<string>;
}

interface RetainCursorStoreV3 {
  version: typeof RETAIN_CURSOR_VERSION;
  sessions: Record<string, SessionRetainCursor | LegacySessionEntry>;
}

interface LegacySessionEntry {
  legacyFingerprints: string[];
}

type RetainCursorStoreV1 = {
  sessions: Record<string, string[]>;
};

interface SessionRetainCursorV2 {
  index: number;
  chainHash: string;
  idChainHash: string;
  messageIds: string[];
  fingerprints: string[];
}

export function retainCursorPath(cwd: string): string {
  return join(cwd, ".pi", "hindsight", "retain-cursors.json");
}

export function messageFingerprint(message: AgentMessage): string {
  const m = message as unknown as Record<string, unknown>;
  const stable = {
    id: m.id,
    role: m.role,
    timestamp: m.timestamp,
    content: m.content,
    toolName: m.toolName,
    isError: m.isError,
    model: m.model,
    stopReason: m.stopReason,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function messageId(message: AgentMessage): string {
  const id = (message as unknown as Record<string, unknown>).id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return "";
}

export function chainHash(fingerprints: readonly string[], throughIndex: number): string {
  let hash = "";
  for (let i = 0; i <= throughIndex; i++) {
    const fingerprint = fingerprints[i];
    if (fingerprint === undefined) break;
    hash = createHash("sha256")
      .update(hash + fingerprint)
      .digest("hex");
  }
  return hash;
}

export function idChainHash(messages: readonly AgentMessage[], throughIndex: number): string {
  let hash = "";
  for (let i = 0; i <= throughIndex; i++) {
    const message = messages[i];
    if (!message) break;
    hash = createHash("sha256")
      .update(hash + messageId(message))
      .digest("hex");
  }
  return hash;
}

function buildCursor(messages: readonly AgentMessage[], throughIndex: number): SessionRetainCursor {
  const tailStart = Math.max(0, throughIndex - RETAIN_CURSOR_TAIL_WINDOW + 1);
  const tailMessages = messages.slice(tailStart, throughIndex + 1);
  const prefixFingerprints = messages.slice(0, throughIndex + 1).map(messageFingerprint);
  return {
    index: throughIndex,
    chainHash: chainHash(prefixFingerprints, throughIndex),
    idChainHash: idChainHash(messages, throughIndex),
    tailStart,
    messageIds: tailMessages.map(messageId),
    fingerprints: tailMessages.map(messageFingerprint),
  };
}

function migrateCursorToV3(cursor: SessionRetainCursorV2): SessionRetainCursor {
  const tailStart = Math.max(0, cursor.index - RETAIN_CURSOR_TAIL_WINDOW + 1);
  return {
    index: cursor.index,
    chainHash: cursor.chainHash,
    idChainHash: cursor.idChainHash,
    tailStart,
    messageIds: cursor.messageIds.slice(tailStart),
    fingerprints: cursor.fingerprints.slice(tailStart),
  };
}

function isLegacySessionEntry(value: unknown): value is LegacySessionEntry {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as LegacySessionEntry).legacyFingerprints)
  );
}

function isSessionRetainCursorV2(value: unknown): value is SessionRetainCursorV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as SessionRetainCursorV2;
  return (
    typeof cursor.index === "number" &&
    typeof cursor.chainHash === "string" &&
    typeof cursor.idChainHash === "string" &&
    Array.isArray(cursor.messageIds) &&
    Array.isArray(cursor.fingerprints) &&
    !("tailStart" in cursor)
  );
}

function isSessionRetainCursor(value: unknown): value is SessionRetainCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as SessionRetainCursor;
  return (
    typeof cursor.index === "number" &&
    typeof cursor.chainHash === "string" &&
    typeof cursor.idChainHash === "string" &&
    typeof cursor.tailStart === "number" &&
    Array.isArray(cursor.messageIds) &&
    Array.isArray(cursor.fingerprints)
  );
}

function normalizeLegacyFingerprints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readLegacyStore(parsed: RetainCursorStoreV1): Record<string, LegacySessionEntry> {
  const sessions: Record<string, LegacySessionEntry> = {};
  for (const [key, value] of Object.entries(parsed.sessions ?? {})) {
    const fingerprints = normalizeLegacyFingerprints(value);
    if (fingerprints.length > 0) sessions[key] = { legacyFingerprints: fingerprints };
  }
  return sessions;
}

function parseFirstJsonDocument(text: string): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

async function readRetainCursorStore(path: string): Promise<RetainCursorStoreV3> {
  try {
    const text = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      // Torn historical writes can leave trailing bytes after the first JSON
      // document (crashed a whole session with "Unexpected non-whitespace
      // character after JSON"). Recover the first complete document; the next
      // atomic write (tmp + rename) rewrites the file cleanly. If even the
      // first document is unusable, rethrow — same behavior as before.
      const recovered = parseFirstJsonDocument(text);
      if (recovered === undefined) throw error;
      parsed = recovered;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: RETAIN_CURSOR_VERSION, sessions: {} };
    }

    const version = (parsed as { version?: unknown }).version;
    const sessions = (parsed as { sessions?: unknown }).sessions;
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
      return { version: RETAIN_CURSOR_VERSION, sessions: {} };
    }

    if (version === RETAIN_CURSOR_VERSION) {
      const normalized: RetainCursorStoreV3["sessions"] = {};
      for (const [key, value] of Object.entries(sessions)) {
        if (isSessionRetainCursor(value)) normalized[key] = value;
        else if (isLegacySessionEntry(value)) normalized[key] = value;
      }
      return { version: RETAIN_CURSOR_VERSION, sessions: normalized };
    }

    if (version === 2) {
      const normalized: RetainCursorStoreV3["sessions"] = {};
      for (const [key, value] of Object.entries(sessions)) {
        if (isSessionRetainCursorV2(value)) normalized[key] = migrateCursorToV3(value);
        else if (isLegacySessionEntry(value)) normalized[key] = value;
      }
      return { version: RETAIN_CURSOR_VERSION, sessions: normalized };
    }

    return {
      version: RETAIN_CURSOR_VERSION,
      sessions: readLegacyStore(parsed as RetainCursorStoreV1),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: RETAIN_CURSOR_VERSION, sessions: {} };
    }
    throw error;
  }
}

async function writeRetainCursorStore(path: string, store: RetainCursorStoreV3): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function readSessionRetainState(
  cwd: string,
  sessionId: string,
): Promise<SessionRetainState | undefined> {
  const store = await readRetainCursorStore(retainCursorPath(cwd));
  const entry = store.sessions[sessionId];
  if (!entry) return undefined;
  if (isLegacySessionEntry(entry)) {
    return { legacyFingerprints: new Set(entry.legacyFingerprints) };
  }
  return { cursor: entry };
}

function legacyRetainStart(messages: readonly AgentMessage[], legacy: ReadonlySet<string>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (legacy.has(messageFingerprint(message))) return i + 1;
  }
  return 0;
}

function prefixChainMatches(
  messages: readonly AgentMessage[],
  cursor: SessionRetainCursor,
): boolean {
  const fingerprints: string[] = [];
  for (let i = 0; i <= cursor.index; i++) {
    const message = messages[i];
    if (!message) return false;
    fingerprints.push(messageFingerprint(message));
  }
  return chainHash(fingerprints, cursor.index) === cursor.chainHash;
}

function filterWithCursor(
  messages: readonly AgentMessage[],
  cursor: SessionRetainCursor,
): AgentMessage[] {
  if (messages.length === 0) return [];

  if (cursor.index < messages.length && prefixChainMatches(messages, cursor)) {
    return messages.slice(cursor.index + 1);
  }

  const retained: AgentMessage[] = [];
  let branched = false;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    if (i > cursor.index) {
      retained.push(message);
      continue;
    }

    if (i < cursor.tailStart) {
      if (branched) retained.push(message);
      continue;
    }

    const offset = i - cursor.tailStart;
    const idMatches = messageId(message) === cursor.messageIds[offset];
    const fingerprintMatches = messageFingerprint(message) === cursor.fingerprints[offset];

    if (!idMatches) {
      branched = true;
      retained.push(message);
      continue;
    }

    if (branched) {
      retained.push(message);
      continue;
    }

    if (!fingerprintMatches) {
      retained.push(message);
    }
  }

  return retained;
}

export function filterNewRetainMessages(
  messages: readonly AgentMessage[],
  state: SessionRetainState | undefined,
): AgentMessage[] {
  if (!state) return [...messages];
  if (state.cursor) return filterWithCursor(messages, state.cursor);
  if (state.legacyFingerprints?.size) {
    return messages.slice(legacyRetainStart(messages, state.legacyFingerprints));
  }
  return [...messages];
}

export async function advanceRetainCursor(
  cwd: string,
  sessionId: string,
  allMessages: readonly AgentMessage[],
  retainedThroughIndex: number,
): Promise<void> {
  if (retainedThroughIndex < 0 || retainedThroughIndex >= allMessages.length) return;

  const path = retainCursorPath(cwd);
  const store = await readRetainCursorStore(path);
  const existing = store.sessions[sessionId];
  const lastIndex = allMessages.length - 1;
  let effectiveIndex = retainedThroughIndex;
  if (isSessionRetainCursor(existing)) {
    effectiveIndex = Math.max(existing.index, retainedThroughIndex);
  }
  effectiveIndex = Math.min(lastIndex, effectiveIndex);
  store.sessions[sessionId] = buildCursor(allMessages, effectiveIndex);
  await writeRetainCursorStore(path, store);
}

export function retainedThroughIndex(
  allMessages: readonly AgentMessage[],
  retainedMessages: readonly AgentMessage[],
): number {
  if (retainedMessages.length === 0) return -1;
  const lastRetained = retainedMessages[retainedMessages.length - 1];
  if (!lastRetained) return -1;
  const lastId = messageId(lastRetained);
  const lastFingerprint = messageFingerprint(lastRetained);
  for (let i = 0; i < allMessages.length; i++) {
    const message = allMessages[i];
    if (!message) continue;
    if (messageId(message) === lastId && messageFingerprint(message) === lastFingerprint) {
      return i;
    }
  }
  return -1;
}
