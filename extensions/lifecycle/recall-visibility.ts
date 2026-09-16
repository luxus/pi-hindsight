import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { throwIfAborted } from "../client/timeout.js";
import type { RecallBlock, RecallFailure } from "../types.js";

export interface LastRecallSnapshot {
  createdAt: string;
  query: string;
  rendered: string;
  blocks: RecallBlock[];
  failed?: number;
  failures?: RecallFailure[];
}

export function resolveLastRecallPath(cwd: string, configuredPath: string): string {
  return isAbsolute(configuredPath) ? configuredPath : join(cwd, configuredPath);
}

export async function writeLastRecallSnapshot(
  cwd: string,
  configuredPath: string,
  snapshot: Omit<LastRecallSnapshot, "createdAt">,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal, "hindsight last-recall snapshot");
  const path = resolveLastRecallPath(cwd, configuredPath);
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  throwIfAborted(signal, "hindsight last-recall snapshot");
  try {
    await writeFile(
      tmp,
      `${JSON.stringify({ createdAt: new Date().toISOString(), ...snapshot }, null, 2)}\n`,
      { encoding: "utf8", ...(signal ? { signal } : {}) },
    );
    throwIfAborted(signal, "hindsight last-recall snapshot");
    await rename(tmp, path);
    return path;
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function readLastRecallSnapshot(
  cwd: string,
  configuredPath: string,
): Promise<LastRecallSnapshot | undefined> {
  try {
    return JSON.parse(
      await readFile(resolveLastRecallPath(cwd, configuredPath), "utf8"),
    ) as LastRecallSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
