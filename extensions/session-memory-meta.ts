import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { stableSessionId } from "./session.js";

export type SessionMemoryMode = "normal" | "read-only" | "ignored";
export type SessionMemorySwitch = "normal" | "off";
export type NextRetainMode = "normal" | "off";

export interface HindsightSessionMeta {
  retained: boolean;
  recallMode: SessionMemorySwitch;
  retainMode: SessionMemorySwitch;
  nextRetainMode: NextRetainMode;
  mode: SessionMemoryMode;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveSessionMemoryMode {
  recall: boolean;
  retain: boolean;
  mode: SessionMemoryMode;
  tags: string[];
}

export function sessionMetaPath(cwd: string, sessionFile?: string): string {
  return join(cwd, ".pi", "hindsight", "session-meta", `${stableSessionId(sessionFile, cwd)}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultSessionMemoryMeta(): HindsightSessionMeta {
  const now = nowIso();
  return {
    retained: true,
    recallMode: "normal",
    retainMode: "normal",
    nextRetainMode: "normal",
    mode: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function failClosedSessionMemoryMeta(): HindsightSessionMeta {
  const now = nowIso();
  return {
    retained: false,
    recallMode: "off",
    retainMode: "off",
    nextRetainMode: "normal",
    mode: "ignored",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function isMode(value: unknown): value is SessionMemoryMode {
  return value === "normal" || value === "read-only" || value === "ignored";
}

function isSwitch(value: unknown): value is SessionMemorySwitch {
  return value === "normal" || value === "off";
}

function cleanTag(tag: string): string {
  return tag.trim();
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function normalizeSessionTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .filter((tag) => !hasControlCharacter(tag))
        .map(cleanTag)
        .filter((tag) => tag.length > 0 && tag.length <= 80),
    ),
  ];
}

type SessionMemoryMetaRecord = Omit<HindsightSessionMeta, "tags"> & { tags: unknown[] };

function isSessionMemoryMetaRecord(value: unknown): value is SessionMemoryMetaRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.retained === "boolean" &&
    isSwitch(record.recallMode) &&
    isSwitch(record.retainMode) &&
    (record.nextRetainMode === undefined || isSwitch(record.nextRetainMode)) &&
    isMode(record.mode) &&
    Array.isArray(record.tags) &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function normalizeSessionMemoryMeta(value: unknown): HindsightSessionMeta {
  if (!isSessionMemoryMetaRecord(value)) return failClosedSessionMemoryMeta();
  return {
    retained: value.retained,
    recallMode: value.recallMode,
    retainMode: value.retainMode,
    nextRetainMode: value.nextRetainMode ?? "normal",
    mode: value.mode,
    tags: normalizeSessionTags(value.tags),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function readSessionMemoryMeta(
  cwd: string,
  sessionFile?: string,
): Promise<HindsightSessionMeta> {
  try {
    return normalizeSessionMemoryMeta(
      JSON.parse(await readFile(sessionMetaPath(cwd, sessionFile), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSessionMemoryMeta();
    return failClosedSessionMemoryMeta();
  }
}

export async function writeSessionMemoryMeta(
  cwd: string,
  sessionFile: string | undefined,
  meta: HindsightSessionMeta,
): Promise<HindsightSessionMeta> {
  const next = { ...meta, tags: normalizeSessionTags(meta.tags), updatedAt: nowIso() };
  const path = sessionMetaPath(cwd, sessionFile);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
  return next;
}

export function getEffectiveSessionMemoryMode(
  meta: HindsightSessionMeta,
): EffectiveSessionMemoryMode {
  if (meta.mode === "ignored")
    return { recall: false, retain: false, mode: meta.mode, tags: meta.tags };
  if (meta.mode === "read-only")
    return { recall: meta.recallMode !== "off", retain: false, mode: meta.mode, tags: meta.tags };
  return {
    recall: meta.recallMode !== "off",
    retain: meta.retainMode !== "off" && meta.retained,
    mode: meta.mode,
    tags: meta.tags,
  };
}

export async function setSessionMemoryMode(
  cwd: string,
  sessionFile: string | undefined,
  mode: SessionMemoryMode,
): Promise<HindsightSessionMeta> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  const updates: Partial<HindsightSessionMeta> = { mode };
  if (mode === "normal" || mode === "read-only") updates.recallMode = "normal";
  const looksFailClosed =
    meta.mode === "ignored" &&
    meta.recallMode === "off" &&
    meta.retainMode === "off" &&
    !meta.retained;
  if (mode === "normal" && looksFailClosed) {
    updates.retained = true;
    updates.retainMode = "normal";
  }
  return writeSessionMemoryMeta(cwd, sessionFile, { ...meta, ...updates });
}

export async function setSessionRetainEnabled(
  cwd: string,
  sessionFile: string | undefined,
  enabled: boolean,
): Promise<HindsightSessionMeta> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  return writeSessionMemoryMeta(cwd, sessionFile, {
    ...meta,
    retained: enabled,
    retainMode: enabled ? "normal" : "off",
  });
}

export async function setNextSessionRetainMode(
  cwd: string,
  sessionFile: string | undefined,
  nextRetainMode: NextRetainMode,
): Promise<HindsightSessionMeta> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  return writeSessionMemoryMeta(cwd, sessionFile, { ...meta, nextRetainMode });
}

export async function consumeNextSessionRetainMode(
  cwd: string,
  sessionFile: string | undefined,
): Promise<{ meta: HindsightSessionMeta; consumed: NextRetainMode }> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  const consumed = meta.nextRetainMode;
  if (consumed === "normal") return { meta, consumed };
  const next = await writeSessionMemoryMeta(cwd, sessionFile, {
    ...meta,
    nextRetainMode: "normal",
  });
  return { meta: next, consumed };
}

export async function addSessionMemoryTag(
  cwd: string,
  sessionFile: string | undefined,
  tag: string,
): Promise<HindsightSessionMeta> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  return writeSessionMemoryMeta(cwd, sessionFile, { ...meta, tags: [...meta.tags, tag] });
}

export async function removeSessionMemoryTag(
  cwd: string,
  sessionFile: string | undefined,
  tag: string,
): Promise<HindsightSessionMeta> {
  const meta = await readSessionMemoryMeta(cwd, sessionFile);
  return writeSessionMemoryMeta(cwd, sessionFile, {
    ...meta,
    tags: meta.tags.filter((existing) => existing !== cleanTag(tag)),
  });
}
