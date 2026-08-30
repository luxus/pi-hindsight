import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  targetBankId?: string;
  searchRoots: string[];
  status: MultiRootImportGroupStatus;
  dryRuns: ImportProjectSessionsResult[];
  importResults: ImportProjectSessionsResult[];
  error?: string;
}

export interface MultiRootProjectImportResult {
  dryRun: boolean;
  discovery: MultiRootSessionDiscoveryResult;
  plan: MultiRootProjectImportPlan;
  groups: MultiRootProjectImportGroupResult[];
  summary: {
    approvedRootCount: number;
    scannedFileCount: number;
    validSessionCount: number;
    invalidSessionCount: number;
    groupCount: number;
    skippedGroupCount: number;
    transientGroupCount: number;
    mappingPairCount: number;
    fanOutGroupCount: number;
    importedPairCount: number;
    failedPairCount: number;
    dryRunGroupCount: number;
    importedGroupCount: number;
    failedGroupCount: number;
    documentCount: number;
    messageCount: number;
    malformedLineCount: number;
    categoryCounts: MultiRootImportCategoryCounts;
  };
}

export interface MultiRootProjectImportPlanMapping {
  cwd: string;
  targetBankIds: string[];
}

export interface MultiRootProjectImportPlanGroup {
  cwd: string;
  sessionCount: number;
  targetBankIds: string[];
  skipped: boolean;
  skipReason?: string;
  fanOut: boolean;
  classification: "active" | "transient" | "stale";
  classificationReasons: string[];
}

export interface MultiRootProjectImportPlan {
  groups: MultiRootProjectImportPlanGroup[];
  summary: {
    groupCount: number;
    skippedGroupCount: number;
    transientGroupCount: number;
    mappingPairCount: number;
    fanOutGroupCount: number;
    invalidCategoryCounts: Record<MultiRootInvalidSession["reason"], number>;
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

function canonicalPathSync(path: string): string {
  try {
    return realpathSync(path);
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

function invalidApprovedRoot(root: string): MultiRootInvalidSession {
  return {
    sessionFile: redactSecrets(root),
    reason: "unreadable",
    error: "Approved root must be absolute.",
  };
}

function uniqueTargetBankIds(targetBankIds: string[]): string[] {
  return targetBankIds
    .map((targetBankId) => targetBankId.trim())
    .filter(Boolean)
    .filter((targetBankId, index, ids) => ids.indexOf(targetBankId) === index);
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const fields = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    fields.status === 404 ||
    fields.statusCode === 404 ||
    fields.code === 404 ||
    fields.code === "404" ||
    (typeof fields.message === "string" && /\b404\b|not found/i.test(fields.message))
  );
}

async function validateTargetBankIds(
  client: HindsightLikeClient,
  targetBankIds: string[],
): Promise<void> {
  const uniqueBankIds = uniqueTargetBankIds(targetBankIds);
  if (uniqueBankIds.length === 0) return;
  if (!client.getBankProfile)
    throw new Error("Cannot validate target Hindsight banks: getBankProfile unavailable.");
  for (const bankId of uniqueBankIds) {
    try {
      const profile = await client.getBankProfile(bankId);
      if (profile == null) throw new Error("empty bank profile response");
    } catch (error) {
      if (isNotFoundError(error))
        throw new Error(`Target Hindsight bank is unavailable: ${redactSecrets(bankId)}`);
      throw new Error(
        `Failed to validate target Hindsight bank ${redactSecrets(bankId)}: ${redactImportError(
          error,
        )}`,
      );
    }
  }
}

function importStatePathForBank(path: string, bankId: string): string {
  const hash = createHash("sha256").update(bankId).digest("hex").slice(0, 8);
  const label = bankId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = `${label || "bank"}-${hash}`;
  const extension = extname(path);
  if (!extension) return `${path}.${suffix}`;
  return `${path.slice(0, -extension.length)}.${suffix}${extension}`;
}

function invalidCategoryCounts(
  invalidSessions: MultiRootInvalidSession[],
): Record<MultiRootInvalidSession["reason"], number> {
  const counts = { "invalid-header": 0, unreadable: 0 };
  for (const invalidSession of invalidSessions) counts[invalidSession.reason] += 1;
  return counts;
}

function classifySourceCwd(
  cwd: string,
): Pick<MultiRootProjectImportPlanGroup, "classification" | "classificationReasons"> {
  const reasons: string[] = [];
  if (!existsSync(cwd)) reasons.push("cwd-missing");
  const normalized = cwd.replaceAll("\\", "/");
  const tmpRoot = resolve(tmpdir()).replaceAll("\\", "/");
  if (
    normalized === tmpRoot ||
    normalized.startsWith(`${tmpRoot}/`) ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/private/tmp/") ||
    normalized.includes("/pi-hindsight-worktrees/")
  ) {
    reasons.push("temporary-worktree-path");
  }
  if (reasons.includes("cwd-missing"))
    return { classification: "stale", classificationReasons: reasons };
  if (reasons.length > 0) return { classification: "transient", classificationReasons: reasons };
  return { classification: "active", classificationReasons: [] };
}

export function buildMultiRootProjectImportPlan(args: {
  discovery: MultiRootSessionDiscoveryResult;
  mappings?: MultiRootProjectImportPlanMapping[];
  defaultBankId?: string;
}): MultiRootProjectImportPlan {
  const mappingByCwd = new Map<string, string[]>();
  const discoveredCwds = new Set(args.discovery.groups.map((group) => group.cwd));
  for (const mapping of args.mappings ?? []) {
    const cwd = canonicalPathSync(mapping.cwd);
    if (!discoveredCwds.has(cwd))
      throw new Error(
        `Submitted import mapping cwd ${redactSecrets(cwd)} does not match a discovered source group.`,
      );
    if (mappingByCwd.has(cwd))
      throw new Error(
        `Duplicate import mapping cwd ${redactSecrets(cwd)} maps to the same source group.`,
      );
    mappingByCwd.set(cwd, uniqueTargetBankIds(mapping.targetBankIds));
  }
  const groups = args.discovery.groups.map((group): MultiRootProjectImportPlanGroup => {
    const targetBankIds = uniqueTargetBankIds(
      mappingByCwd.get(group.cwd) ?? (args.defaultBankId ? [args.defaultBankId] : []),
    );
    const classification = classifySourceCwd(group.cwd);
    return {
      cwd: group.cwd,
      sessionCount: group.sessions.length,
      targetBankIds,
      skipped: targetBankIds.length === 0,
      ...(targetBankIds.length === 0 ? { skipReason: "No target bank selected." } : {}),
      fanOut: targetBankIds.length > 1,
      ...classification,
    };
  });
  return {
    groups,
    summary: {
      groupCount: groups.length,
      skippedGroupCount: groups.filter((group) => group.skipped).length,
      transientGroupCount: groups.filter((group) => group.classification !== "active").length,
      mappingPairCount: groups.reduce((count, group) => count + group.targetBankIds.length, 0),
      fanOutGroupCount: groups.filter((group) => group.fanOut).length,
      invalidCategoryCounts: invalidCategoryCounts(args.discovery.invalidSessions),
    },
  };
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
  const rootInputs = args.approvedRoots.map((root) => root.trim()).filter(Boolean);
  const invalidSessions = rootInputs.filter((root) => !isAbsolute(root)).map(invalidApprovedRoot);
  const approvedRoots = (
    await Promise.all(
      rootInputs.filter((root) => isAbsolute(root)).map((root) => canonicalPath(root)),
    )
  )
    .filter((root, index, roots) => roots.indexOf(root) === index)
    .sort();
  const validSessions: Array<{ cwd: string; session: PendingSessionHeader }> = [];
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

function sessionFilesForSearchRoot(group: MultiRootSessionGroup, searchRoot: string): string[] {
  return group.sessions
    .map((session) => session.sessionFile)
    .filter((sessionFile) => {
      const path = relative(searchRoot, sessionFile);
      return path && !path.startsWith("..") && !isAbsolute(path);
    })
    .sort();
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
  plan: MultiRootProjectImportPlan,
  groups: MultiRootProjectImportGroupResult[],
) {
  return {
    approvedRootCount: discovery.approvedRoots.length,
    scannedFileCount: discovery.scannedFileCount,
    validSessionCount: discovery.validSessionCount,
    invalidSessionCount: discovery.invalidSessionCount,
    groupCount: discovery.groups.length,
    skippedGroupCount: plan.summary.skippedGroupCount,
    transientGroupCount: plan.summary.transientGroupCount,
    mappingPairCount: plan.summary.mappingPairCount,
    fanOutGroupCount: plan.summary.fanOutGroupCount,
    importedPairCount: groups.filter((group) => group.status === "imported").length,
    failedPairCount: groups.filter((group) => group.status.endsWith("failed")).length,
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
    bankId?: string;
    importPlan?: { mappings: MultiRootProjectImportPlanMapping[] };
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
  const plan = buildMultiRootProjectImportPlan({
    discovery,
    ...(args.importPlan ? { mappings: args.importPlan.mappings } : {}),
    ...(args.bankId ? { defaultBankId: args.bankId } : {}),
  });
  const groups: MultiRootProjectImportGroupResult[] = [];
  const dryRun = args.dryRun ?? false;
  const dryRunFirst = !dryRun && (args.dryRunFirst ?? false);
  await validateTargetBankIds(
    args.client,
    plan.groups.flatMap((group) => group.targetBankIds),
  );

  const delegateGroup = async (
    group: MultiRootSessionGroup,
    targetBankId: string,
    searchRoots: string[],
    delegateDryRun: boolean,
  ): Promise<ImportProjectSessionsResult[]> => {
    const results: ImportProjectSessionsResult[] = [];
    for (const searchDir of searchRoots) {
      results.push(
        await importProjectSessions({
          cwd: group.cwd,
          searchDir,
          bankId: targetBankId,
          client: args.client,
          config: {
            ...args.config,
            import: {
              ...args.config.import,
              manifestPath: importStatePathForBank(args.config.import.manifestPath, targetBankId),
              checkpointPath: importStatePathForBank(
                args.config.import.checkpointPath,
                targetBankId,
              ),
            },
          },
          dryRun: delegateDryRun,
          sessionFiles: sessionFilesForSearchRoot(group, searchDir),
          ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
          ...(args.onProgress ? { onProgress: args.onProgress } : {}),
        }),
      );
    }
    return results;
  };

  if (dryRun || dryRunFirst) {
    for (const planned of plan.groups.filter((group) => !group.skipped)) {
      const group = discovery.groups.find((candidate) => candidate.cwd === planned.cwd);
      if (!group) continue;
      const searchRoots = rootsForGroup(discovery, group.cwd);
      for (const targetBankId of planned.targetBankIds) {
        try {
          groups.push({
            cwd: group.cwd,
            targetBankId,
            searchRoots,
            status: "dry-run-completed",
            dryRuns: await delegateGroup(group, targetBankId, searchRoots, true),
            importResults: [],
          });
        } catch (error) {
          groups.push({
            cwd: group.cwd,
            targetBankId,
            searchRoots,
            status: "dry-run-failed",
            dryRuns: [],
            importResults: [],
            error: redactImportError(error),
          });
        }
      }
    }
    if (dryRun || groups.some((group) => group.status === "dry-run-failed")) {
      return {
        dryRun,
        discovery,
        plan,
        groups,
        summary: multiRootImportSummary(discovery, plan, groups),
      };
    }
  }

  for (const planned of plan.groups.filter((group) => !group.skipped)) {
    const group = discovery.groups.find((candidate) => candidate.cwd === planned.cwd);
    if (!group) continue;
    const searchRoots = rootsForGroup(discovery, group.cwd);
    for (const targetBankId of planned.targetBankIds) {
      const preflight = groups.find(
        (candidate) => candidate.cwd === group.cwd && candidate.targetBankId === targetBankId,
      );
      const dryRuns: ImportProjectSessionsResult[] = preflight?.dryRuns ?? [];
      const importResults: ImportProjectSessionsResult[] = [];

      try {
        importResults.push(...(await delegateGroup(group, targetBankId, searchRoots, false)));
      } catch (error) {
        const failedGroup = {
          cwd: group.cwd,
          targetBankId,
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
        targetBankId,
        searchRoots,
        status: "imported" as const,
        dryRuns,
        importResults,
      };
      if (preflight) groups[groups.indexOf(preflight)] = importedGroup;
      else groups.push(importedGroup);
    }
  }

  return {
    dryRun,
    discovery,
    plan,
    groups,
    summary: multiRootImportSummary(discovery, plan, groups),
  };
}

export async function importMemoryMultiRootProjectSessions(
  args: {
    approvedRoots: string[];
    bank?: string;
    importPlan?: { mappings: MultiRootProjectImportPlanMapping[] };
    dryRun?: boolean;
    dryRunFirst?: boolean;
    includeBranches?: ResolvedConfig["import"]["includeBranches"];
    onProgress?: ImportProgressReporter;
  },
  deps: ImportOperationDeps,
  delegateDeps: { importProjectSessions?: ImportProjectSessionsDelegate } = {},
) {
  const config = deps.getConfig();
  const needsBankResolution =
    Boolean(args.bank) ||
    Boolean(
      args.importPlan?.mappings.some((mapping) =>
        mapping.targetBankIds.some((targetBankId) =>
          ["project", "global", "user"].includes(targetBankId),
        ),
      ),
    );
  const projectBankId = needsBankResolution ? deps.getProjectBankId() : "";
  const resolveMultiRootOperationBank = (requestedBank: string) =>
    requestedBank === "user"
      ? resolveOperationBank({
          requestedBank: "global",
          config,
          projectBankId,
        })
      : resolveOperationBank({
          requestedBank,
          config,
          projectBankId,
        });
  const bankId = args.bank ? resolveMultiRootOperationBank(args.bank) : undefined;
  const importPlan = args.importPlan
    ? {
        mappings: args.importPlan.mappings.map((mapping) => ({
          cwd: mapping.cwd,
          targetBankIds: mapping.targetBankIds.map(resolveMultiRootOperationBank),
        })),
      }
    : undefined;
  const result = await importMultiRootProjectSessions(
    {
      approvedRoots: args.approvedRoots,
      ...(bankId ? { bankId } : {}),
      ...(importPlan ? { importPlan } : {}),
      client: deps.getClient(),
      config,
      ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      ...(args.dryRunFirst !== undefined ? { dryRunFirst: args.dryRunFirst } : {}),
      ...(args.includeBranches ? { includeBranches: args.includeBranches } : {}),
      ...(args.onProgress ? { onProgress: args.onProgress } : {}),
    },
    delegateDeps,
  );
  return { ...(bankId ? { bankId } : {}), ...result };
}
