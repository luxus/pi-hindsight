import type { HindsightLikeClient, ResolvedConfig } from "./types.js";
import { importDocumentId, stableSessionId } from "./session.js";
import { baseTags } from "./banking.js";
import { redactSecrets } from "./sanitize.js";
import { hashImportContent, type ImportManifestEntry } from "./import-manifest.js";
import { createMemoryIdentity } from "./memory-identity.js";
import { isInjectedHindsightMemory } from "./messages.js";
import { expandObservationScopes } from "./observation-scopes.js";
import type { ImportBranch } from "./import-branches.js";
import type { ParsedSession } from "./import-parser.js";

export interface ImportRetainArgs {
  sessionFile: string;
  bankId: string;
  client: HindsightLikeClient;
  config: ResolvedConfig;
  parsed: ParsedSession;
  cwd: string;
  sessionId: string;
  leaves: string[];
  branch: ImportBranch;
}

export interface ImportDocumentPreview {
  documentId: string;
  leafId: string;
  messageCount: number;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  updateMode: "append" | "replace";
  bankId: string;
  wouldWrite: boolean;
  status: "pending" | "completed" | "failed" | "skipped";
  error?: string;
}

export interface ImportRetainResult {
  document: ImportDocumentPreview;
  manifestEntry: ImportManifestEntry;
}

interface ImportBranchBuildResult extends ImportRetainResult {
  content: string;
  context: string;
  observationScopes: string[][];
}

function resolvedParentSessionId(parsed: ParsedSession, cwd: string): string | undefined {
  return (
    parsed.parentSessionId ??
    (parsed.parentSessionFile ? stableSessionId(parsed.parentSessionFile, cwd) : undefined)
  );
}

function buildImportBranch(args: Omit<ImportRetainArgs, "client">): ImportBranchBuildResult {
  const leafId = args.branch.leafId;
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  const branchMessages = args.branch.messages.filter(
    (message) => !isInjectedHindsightMemory(message.data),
  );
  const documentId = importDocumentId(args.sessionId, leafId);
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
  const contentRaw = JSON.stringify(
    {
      source: "pi-session-import",
      sessionFile: args.sessionFile,
      cwd: args.parsed.cwd,
      sessionId: args.sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(args.parsed.parentSessionFile
        ? { parentSessionFile: args.parsed.parentSessionFile }
        : {}),
      branchLeafId: leafId,
      messages: branchMessages.map((message) => message.data),
    },
    null,
    2,
  );
  const content = args.config.retain.redactSecrets ? redactSecrets(contentRaw) : contentRaw;
  const contentHash = hashImportContent(content);
  const tags = [
    ...baseTags(args.cwd, args.sessionId, leafId),
    "import:historical",
    "imported:true",
    `document:${documentId}`,
  ];
  if (parentSessionId) tags.push(`parent:${parentSessionId}`);
  if (args.leaves.length > 1) tags.push("forked:true");
  const identity = createMemoryIdentity(args.cwd, args.config, args.sessionFile);
  const observationScopes = args.config.observations.enabled
    ? expandObservationScopes(args.config.observations.scopes, {
        ...identity,
        sessionId: args.sessionId,
        projectBankId: args.bankId,
      })
    : [];
  const document: ImportDocumentPreview = {
    documentId,
    leafId,
    messageCount: branchMessages.length,
    contentHash,
    contentBytes: Buffer.byteLength(content, "utf8"),
    tags,
    updateMode,
    bankId: args.bankId,
    wouldWrite: true,
    status: "pending" as const,
  };
  const manifestEntry: ImportManifestEntry = {
    documentId,
    bankId: args.bankId,
    sourceFile: args.sessionFile,
    importedAt: new Date().toISOString(),
    contentHash,
    messageCount: branchMessages.length,
    leafId,
    sessionId: args.sessionId,
    cwd: args.cwd,
    includeBranches: args.config.import.includeBranches,
    updateMode,
  };
  return {
    document,
    manifestEntry,
    content,
    context: `Historical Pi session import from ${args.sessionFile}, branch ${leafId}`,
    observationScopes,
  };
}

export function previewImportBranch(args: Omit<ImportRetainArgs, "client">): ImportRetainResult {
  const built = buildImportBranch(args);
  return { document: { ...built.document, wouldWrite: false }, manifestEntry: built.manifestEntry };
}

export async function retainImportBranch(args: ImportRetainArgs): Promise<ImportRetainResult> {
  const built = buildImportBranch(args);
  const parentSessionId = resolvedParentSessionId(args.parsed, args.cwd);
  await args.client.retain(args.bankId, built.content, {
    context: built.context,
    documentId: built.document.documentId,
    updateMode: built.document.updateMode,
    async: args.config.retain.async,
    tags: built.document.tags,
    metadata: {
      pi_session_file: args.sessionFile,
      imported: "true",
      cwd: args.cwd,
      session_id: args.sessionId,
      ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
      ...(args.parsed.parentSessionFile
        ? { parent_session_file: args.parsed.parentSessionFile }
        : {}),
      branch_leaf_id: built.document.leafId,
      include_branches: args.config.import.includeBranches,
      ...(args.parsed.sessionTimestamp ? { session_timestamp: args.parsed.sessionTimestamp } : {}),
    },
    ...(built.observationScopes.length ? { observationScopes: built.observationScopes } : {}),
  });
  return { document: built.document, manifestEntry: built.manifestEntry };
}
