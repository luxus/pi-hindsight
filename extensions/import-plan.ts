import { dirname, resolve } from "node:path";
import type { ResolvedConfig } from "./types.js";
import type { ParsedSession } from "./import-parser.js";
import { leafIds, selectImportBranches, type ImportBranch } from "./import-branches.js";
import { resolveImportManifestPath } from "./import-manifest.js";
import { importRunId, resolveImportCheckpointPath } from "./import-checkpoint.js";
import { stableSessionId } from "./session.js";

export interface ImportPlan {
  sessionFile: string;
  bankId: string;
  cwd: string;
  sessionId: string;
  leaves: string[];
  includeBranches: ResolvedConfig["import"]["includeBranches"];
  branches: ImportBranch[];
  manifestPath: string;
  checkpointPath: string;
  updateMode: "append" | "replace";
  runId: string;
  importConfig: ResolvedConfig;
}

function sameCwd(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return resolve(left) === resolve(right);
}

export function buildImportPlan(args: {
  sessionFile: string;
  parsed: ParsedSession;
  bankId: string;
  config: ResolvedConfig;
  cwd?: string;
  requireMatchingCwd?: boolean;
  includeBranches?: ResolvedConfig["import"]["includeBranches"];
}): ImportPlan {
  if (args.cwd && args.requireMatchingCwd && !args.parsed.cwd) {
    throw new Error(
      `Refusing to import session without cwd; current cwd is ${args.cwd}. Use explicit file import for unscoped sessions.`,
    );
  }
  if (args.cwd && args.parsed.cwd && !sameCwd(args.parsed.cwd, args.cwd)) {
    throw new Error(
      `Refusing to import session from cwd ${args.parsed.cwd}; current cwd is ${args.cwd}. Use project-scoped import from the matching repo.`,
    );
  }
  const cwd = resolve(args.cwd ?? args.parsed.cwd ?? dirname(args.sessionFile));
  const sessionId = args.parsed.sessionId ?? stableSessionId(args.sessionFile, cwd);
  const leaves = leafIds(args.parsed.messages);
  const includeBranches = args.includeBranches ?? args.config.import.includeBranches;
  const branches = selectImportBranches(args.parsed, includeBranches);
  const manifestPath = resolveImportManifestPath(cwd, args.config.import.manifestPath);
  const checkpointPath = resolveImportCheckpointPath(cwd, args.config.import.checkpointPath);
  const updateMode = args.config.import.replaceExistingImportedDocs ? "replace" : "append";
  const runId = importRunId({
    sourceFile: args.sessionFile,
    bankId: args.bankId,
    sessionId,
    includeBranches,
    importMode: args.config.import.mode,
    updateMode,
  });
  return {
    sessionFile: args.sessionFile,
    bankId: args.bankId,
    cwd,
    sessionId,
    leaves,
    includeBranches,
    branches,
    manifestPath,
    checkpointPath,
    updateMode,
    runId,
    importConfig: { ...args.config, import: { ...args.config.import, includeBranches } },
  };
}
