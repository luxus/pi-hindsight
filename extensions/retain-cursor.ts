import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface RetainCursorStore {
  sessions: Record<string, string[]>;
}

export const RETAIN_CURSOR_LIMITS = {
  maxFingerprintsPerSession: 2_000,
};

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

export async function readRetainCursorStore(path: string): Promise<RetainCursorStore> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { sessions: {} };
    const sessions = (parsed as { sessions?: unknown }).sessions;
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions))
      return { sessions: {} };
    const normalized: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(sessions)) {
      if (Array.isArray(value))
        normalized[key] = value.filter((item): item is string => typeof item === "string");
    }
    return { sessions: normalized };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {} };
    throw error;
  }
}

export async function writeRetainCursorStore(
  path: string,
  store: RetainCursorStore,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function readRetainFingerprints(cwd: string, sessionId: string): Promise<Set<string>> {
  const store = await readRetainCursorStore(retainCursorPath(cwd));
  return new Set(store.sessions[sessionId] ?? []);
}

export async function addRetainFingerprints(
  cwd: string,
  sessionId: string,
  fingerprints: string[],
): Promise<void> {
  const path = retainCursorPath(cwd);
  const store = await readRetainCursorStore(path);
  store.sessions[sessionId] = [
    ...new Set([...(store.sessions[sessionId] ?? []), ...fingerprints]),
  ].slice(-RETAIN_CURSOR_LIMITS.maxFingerprintsPerSession);
  await writeRetainCursorStore(path, store);
}
