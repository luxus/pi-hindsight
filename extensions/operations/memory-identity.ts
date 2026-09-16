import type { ResolvedConfig } from "../types.js";
import {
  baseTags,
  deriveProjectBankId,
  recallScopeTags,
  resolveProjectIdentity,
  type ProjectIdBasis,
} from "../banks/banking.js";
import { importDocumentId, liveDocumentId, stableSessionId } from "../utils/session.js";

export interface MemoryIdentity {
  cwd: string;
  sessionFile?: string;
  /** Stable project id (pin / remote / basename). */
  projectId: string;
  projectIdBasis: ProjectIdBasis;
  projectIdSource: string;
  /** Legacy path-hash key; still dual-tagged during migration. */
  repoKey: string;
  sessionId: string;
  projectBankId: string;
  liveDocumentId: string;
  baseTags: string[];
  projectRecallTags: string[];
  globalRecallTags: string[];
}

export function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.filter(Boolean))];
}

export function mergeBaseAndExtraTags(base: string[], extra: string[] | undefined): string[] {
  return uniqueTags([...base, ...(extra ?? [])]);
}

export function createMemoryIdentity(
  cwd: string,
  config: ResolvedConfig,
  sessionFile?: string,
): MemoryIdentity {
  const sessionId = stableSessionId(sessionFile, cwd);
  const project = resolveProjectIdentity(cwd, config);
  return {
    cwd,
    ...(sessionFile ? { sessionFile } : {}),
    projectId: project.projectId,
    projectIdBasis: project.basis,
    projectIdSource: project.source,
    repoKey: project.legacyRepoKey,
    sessionId,
    projectBankId: deriveProjectBankId(cwd, config),
    liveDocumentId: liveDocumentId(sessionFile, cwd),
    baseTags: baseTags(cwd, sessionId, config),
    projectRecallTags: recallScopeTags(cwd, config),
    globalRecallTags: uniqueTags(config.scope.userScopeTags),
  };
}

export function explicitRetainTags(
  cwd: string,
  sessionFile: string | undefined,
  extraTags: string[] | undefined,
  config?: ResolvedConfig,
): string[] {
  return mergeBaseAndExtraTags(baseTags(cwd, stableSessionId(sessionFile, cwd), config), extraTags);
}

export { importDocumentId, liveDocumentId, stableSessionId };
