import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { redactError, redactSecrets } from "../utils/sanitize.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import {
  importProjectSessions as defaultImportProjectSessions,
  type ImportOperationDeps,
  type ImportProgressReporter,
  type ImportProjectSessionsResult,
} from "./import-sessions.js";

export type MultiRootImportGroupStatus =
  | "dry-run-completed"
  | "dry-run-failed"
  | "imported"
  | "import-failed";

export type MultiRootImportOutcomeCategory =
  | MultiRootInvalidSession["reason"]
  | MultiRootImportGroupStatus;

export type MultiRootImportCategoryCounts = Record<MultiRootImportOutcomeCategory, number>;

export interface MultiRootSessionHeader {
  sessionFile: string;
  sessionId: string;
}

export interface MultiRootInvalidSession {
  sessionFile: string;
  reason: "invalid-header" | "unreadable";
  error?: string;
}

export interface MultiRootSessionGroup {
  cwd: string;
  sessions: MultiRootSessionHeader[];
}

export interface MultiRootSessionDiscoveryResult {
  approvedRoots: string[];
  scannedFileCount: number;
  validSessionCount: number;
  invalidSessionCount: number;
  groups: MultiRootSessionGroup[];
  invalidSessions: MultiRootInvalidSession[];
}

export interface MultiRootProjectImportGroupResult {
  cwd: string;
  searchRoots: string[];
  status: MultiRootImportGroupStatus;
  dryRuns: ImportProjectSessionsResult[];
  importResults: ImportProjectSessionsResult[];
  error?: string;
}

export interface MultiRootProjectImportResult {
  dryRun: boolean;
  discovery: MultiRootSessionDiscoveryResult;
  groups: MultiRootProjectImportGroupResult[];
  summary: {
    approvedRootCount: number;
    scannedFileCount: number;
    validSessionCount: number;
    invalidSessionCount: number;
    groupCount: number;
    dryRunGroupCount: number;
    importedGroupCount: number;
    failedGroupCount: number;
    documentCount: number;
    messageCount: number;
    malformedLineCount: number;
    categoryCounts: MultiRootImportCategoryCounts;
  };
}

type ImportProjectSessionsDelegate = typeof defaultImportProjectSessions;

interface SessionHeader {
  cwd: string;
  sessionId: string;
}

interface PendingSessionHeader extends MultiRootSessionHeader {
  root: string;
}

const SESSION_HEADER_READ_CHUNK_BYTES = 4096;
const SESSION_HEADER_MAX_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function parseSessionHeaderLine(line: string): SessionHeader | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.type !== "session") return undefined;
  if (typeof parsed.cwd !== "string" || !parsed.cwd.trim()) return undefined;
  if (typeof parsed.id !== "string" || !parsed.id.trim()) return undefined;
  return { cwd: parsed.cwd, sessionId: parsed.id };
}

async function readSessionHeader(sessionFile: string): Promise<SessionHeader | undefined> {
  const handle = await open(sessionFile, "r");
  try {
    const buffer = Buffer.alloc(SESSION_HEADER_READ_CHUNK_BYTES);
    let text = "";
    let bytesReadTotal = 0;
    while (bytesReadTotal < SESSION_HEADER_MAX_BYTES) {
      const remaining = SESSION_HEADER_MAX_BYTES - bytesReadTotal;
      const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), bytesReadTotal);
      if (read.bytesRead === 0) break;
      bytesReadTotal += read.bytesRead;
      text += buffer.toString("utf8", 0, read.bytesRead);
      const lines = text.split("\n");
      for (const line of lines.slice(0, -1)) {
        if (line.trim()) return parseSessionHeaderLine(line);
      }
      if (text.includes("\n")) text = lines.at(-1) ?? "";
    }
    const line = text.split("\n").find((candidate) => candidate.trim());
    return line ? parseSessionHeaderLine(line) : undefined;
  } finally {
    await handle.close();
  }
}

function redactImportError(error: unknown): string {
  return redactSecrets(redactError(error));
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || extname(entry.name) !== ".jsonl") continue;
      const info = await lstat(path);
      if (info.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

export async function discoverMultiRootPiSessionHeaders(args: {
  approvedRoots: string[];
}): Promise<MultiRootSessionDiscoveryResult> {
  const approvedRoots = (await Promise.all(args.approvedRoots.map((root) => canonicalPath(root))))
    .filter((root, index, roots) => roots.indexOf(root) === index)
    .sort();
  const validSessions: Array<{ cwd: string; session: PendingSessionHeader }> = [];
  const invalidSessions: MultiRootInvalidSession[] = [];
  const seenSessionFiles = new Set<string>();
  let scannedFileCount = 0;

  for (const root of approvedRoots) {
    let files: string[];
    try {
      files = await collectJsonlFiles(root);
    } catch (error) {
      invalidSessions.push({
        sessionFile: root,
        reason: "unreadable",
        error: redactImportError(error),
      });
      continue;
    }
    for (const discoveredSessionFile of files) {
      const sessionFile = await canonicalPath(discoveredSessionFile);
      if (seenSessionFiles.has(sessionFile)) continue;
      seenSessionFiles.add(sessionFile);
      scannedFileCount += 1;
      let header: SessionHeader | undefined;
      try {
        header = await readSessionHeader(sessionFile);
      } catch (error) {
        invalidSessions.push({
          sessionFile,
          reason: "unreadable",
          error: redactImportError(error),
        });
        continue;
      }
      if (!header) {
        invalidSessions.push({ sessionFile, reason: "invalid-header" });
        continue;
      }
      validSessions.push({
        cwd: await canonicalPath(header.cwd),
        session: { sessionFile, sessionId: header.sessionId, root },
      });
    }
  }

  const grouped = new Map<string, PendingSessionHeader[]>();
  for (const item of validSessions) {
    grouped.set(item.cwd, [...(grouped.get(item.cwd) ?? []), item.session]);
  }

  return {
    approvedRoots,
    scannedFileCount,
    validSessionCount: validSessions.length,
    invalidSessionCount: invalidSessions.length,
    groups: [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([cwd, sessions]) => ({
        cwd,
        sessions: sessions
          .map(({ sessionFile, sessionId }) => ({ sessionFile, sessionId }))
          .sort((left, right) => left.sessionFile.localeCompare(right.sessionFile)),
      })),
    invalidSessions: invalidSessions.sort((left, right) =>
      left.sessionFile.localeCompare(right.sessionFile),
    ),
  };
}

function rootsForGroup(discovery: MultiRootSessionDiscoveryResult, cwd: string): string[] {
  const group = discovery.groups.find((candidate) => candidate.cwd === cwd);
  if (!group) return [];
  return [
    ...new Set(
      group.sessions.map((session) => {
        const root = discovery.approvedRoots.find((candidate) => {
          const path = relative(candidate, session.sessionFile);
          return path && !path.startsWith("..") && !isAbsolute(path);
        });
        return root ?? dirname(session.sessionFile);
      }),
    ),
  ].sort();
}

function aggregateDocumentCount(groups: MultiRootProjectImportGroupResult[]): number {
  return groups.reduce((count, group) => {
    const results = group.importResults.length ? group.importResults : group.dryRuns;
    return count + results.reduce((innerCount, result) => innerCount + result.documentCount, 0);
  }, 0);
}

function aggregateMessageCount(groups: MultiRootProjectImportGroupResult[]): number {
  return groups.reduce((count, group) => {
    const results = group.importResults.length ? group.importResults : group.dryRuns;
    return count + results.reduce((innerCount, result) => innerCount + result.messageCount, 0);
  }, 0);
}

function aggregateMalformedLineCount(groups: MultiRootProjectImportGroupResult[]): number {
  return groups.reduce((count, group) => {
    const results = group.importResults.length ? group.importResults : group.dryRuns;
    return (
      count + results.reduce((innerCount, result) => innerCount + result.malformedLineCount, 0)
    );
  }, 0);
}

function multiRootImportCategoryCounts(
  discovery: MultiRootSessionDiscoveryResult,
  groups: MultiRootProjectImportGroupResult[],
): MultiRootImportCategoryCounts {
  const counts: MultiRootImportCategoryCounts = {
    unreadable: 0,
    "invalid-header": 0,
    "dry-run-completed": 0,
    "dry-run-failed": 0,
    imported: 0,
    "import-failed": 0,
  };
  for (const invalidSession of discovery.invalidSessions) counts[invalidSession.reason] += 1;
  for (const group of groups) counts[group.status] += 1;
  return counts;
}

function multiRootImportSummary(
  discovery: MultiRootSessionDiscoveryResult,
  groups: MultiRootProjectImportGroupResult[],
) {
  return {
    approvedRootCount: discovery.approvedRoots.length,
    scannedFileCount: discovery.scannedFileCount,
    validSessionCount: discovery.validSessionCount,
    invalidSessionCount: discovery.invalidSessionCount,
    groupCount: discovery.groups.length,
    dryRunGroupCount: groups.filter((group) => group.dryRuns.length > 0).length,
    importedGroupCount: groups.filter((group) => group.status === "imported").length,
    failedGroupCount: groups.filter((group) => group.status.endsWith("failed")).length,
    documentCount: aggregateDocumentCount(groups),
    messageCount: aggregateMessageCount(groups),
    malformedLineCount: aggregateMalformedLineCount(groups),
    categoryCounts: multiRootImportCategoryCounts(discovery, groups),
  };
}

export async function importMultiRootProjectSessions(
  args: {
    approvedRoots: string[];
    bankId: string;
    client: HindsightLikeClient;
    config: ResolvedConfig;
    dryRun?: boolean;
    dryRunFirst?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: { importProjectSessions?: ImportProjectSessionsDelegate } = {},
): Promise<MultiRootProjectImportResult> {
  const importProjectSessions = deps.importProjectSessions ?? defaultImportProjectSessions;
  const discovery = await discoverMultiRootPiSessionHeaders({ approvedRoots: args.approvedRoots });
  const groups: MultiRootProjectImportGroupResult[] = [];
  const dryRun = args.dryRun ?? false;
  const dryRunFirst = !dryRun && (args.dryRunFirst ?? false);

  const delegateGroup = async (
    group: MultiRootSessionGroup,
    searchRoots: string[],
    delegateDryRun: boolean,
  ): Promise<ImportProjectSessionsResult[]> => {
    const results: ImportProjectSessionsResult[] = [];
    for (const searchDir of searchRoots) {
      results.push(
        await importProjectSessions({
          cwd: group.cwd,
          searchDir,
          bankId: args.bankId,
          client: args.client,
          config: args.config,
          dryRun: delegateDryRun,
          ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
          ...(args.onProgress ? { onProgress: args.onProgress } : {}),
        }),
      );
    }
    return results;
  };

  if (dryRun || dryRunFirst) {
    for (const group of discovery.groups) {
      const searchRoots = rootsForGroup(discovery, group.cwd);
      try {
        groups.push({
          cwd: group.cwd,
          searchRoots,
          status: "dry-run-completed",
          dryRuns: await delegateGroup(group, searchRoots, true),
          importResults: [],
        });
      } catch (error) {
        groups.push({
          cwd: group.cwd,
          searchRoots,
          status: "dry-run-failed",
          dryRuns: [],
          importResults: [],
          error: redactImportError(error),
        });
      }
    }
    if (dryRun || groups.some((group) => group.status === "dry-run-failed")) {
      return {
        dryRun,
        discovery,
        groups,
        summary: multiRootImportSummary(discovery, groups),
      };
    }
  }

  for (const group of discovery.groups) {
    const searchRoots = rootsForGroup(discovery, group.cwd);
    const preflight = groups.find((candidate) => candidate.cwd === group.cwd);
    const dryRuns: ImportProjectSessionsResult[] = preflight?.dryRuns ?? [];
    const importResults: ImportProjectSessionsResult[] = [];

    try {
      importResults.push(...(await delegateGroup(group, searchRoots, false)));
    } catch (error) {
      const failedGroup = {
        cwd: group.cwd,
        searchRoots,
        status: "import-failed" as const,
        dryRuns,
        importResults,
        error: redactImportError(error),
      };
      if (preflight) groups[groups.indexOf(preflight)] = failedGroup;
      else groups.push(failedGroup);
      continue;
    }

    const importedGroup = {
      cwd: group.cwd,
      searchRoots,
      status: "imported" as const,
      dryRuns,
      importResults,
    };
    if (preflight) groups[groups.indexOf(preflight)] = importedGroup;
    else groups.push(importedGroup);
  }

  return {
    dryRun,
    discovery,
    groups,
    summary: multiRootImportSummary(discovery, groups),
  };
}

export async function importMemoryMultiRootProjectSessions(
  args: {
    approvedRoots: string[];
    bank?: string;
    dryRun?: boolean;
    dryRunFirst?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
) {
  const bankId = resolveOperationBank({
    requestedBank: args.bank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
  const result = await importMultiRootProjectSessions({
    approvedRoots: args.approvedRoots,
    bankId,
    client: deps.getClient(),
    config: deps.getConfig(),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.dryRunFirst !== undefined ? { dryRunFirst: args.dryRunFirst } : {}),
    ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { bankId, ...result };
}
