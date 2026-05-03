import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { RecallBlock, RecallFailure } from "./types.js";

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
): Promise<string> {
  const path = resolveLastRecallPath(cwd, configuredPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ createdAt: new Date().toISOString(), ...snapshot }, null, 2)}\n`,
    "utf8",
  );
  return path;
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
