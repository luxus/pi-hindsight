import { checkHindsight } from "../client/client.js";
import { formatDebugReport } from "../utils/diagnostics.js";
import { resolveQueuePath, summarizeRetainQueue } from "../queue/queue.js";
import {
  importManifestSummary,
  readImportManifestSafe,
  resolveImportManifestPath,
} from "../imports/import-plan.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import {
  buildScopeMigratePlan,
  writeScopeMigrateReceipt,
  type ScopeMigratePlan,
} from "./scope-migrate.js";

export function createDiagnosticsOperations(deps: MemoryOperationsDeps) {
  return {
    async doctor(cwd: string, sessionFile?: string): Promise<string> {
      const config = deps.getConfig();
      const projectBankId = deps.getProjectBankId();
      const manifestPath = resolveImportManifestPath(cwd, config.import.manifestPath);
      const [health, queueSummary, manifestResult] = await Promise.all([
        checkHindsight(deps.getClient(), projectBankId),
        summarizeRetainQueue(resolveQueuePath(cwd, config.retain.queuePath)),
        readImportManifestSafe(manifestPath),
      ]);
      const imports = importManifestSummary(manifestResult.manifest);
      const scopeMigrate = buildScopeMigratePlan({ cwd, config, projectBankId });
      return formatDebugReport({
        cwd,
        ...(sessionFile ? { sessionFile } : {}),
        projectBankId,
        config,
        queueLength: queueSummary.active.valid,
        queuePath: queueSummary.active.path,
        queueMalformedLines: queueSummary.active.malformed,
        queueReadError: queueSummary.active.error,
        deadLetterPath: queueSummary.deadLetter.path,
        deadLetterLength: queueSummary.deadLetter.valid,
        deadLetterMalformedLines: queueSummary.deadLetter.malformed,
        deadLetterReadError: queueSummary.deadLetter.error,
        importManifestPath: manifestPath,
        importManifestError: manifestResult.error,
        importManifestAction: manifestResult.action,
        importCount: imports.count,
        ...(imports.latest ? { latestImport: imports.latest } : {}),
        health,
        scopeMigrate,
      });
    },

    /**
     * Dry-run only: plan dual-tag / legacy repo-tag migration guidance and write a local receipt.
     * Never rewrites Hindsight tags or documents.
     */
    async scopeMigrateDryRun(
      cwd: string,
      options: { bankTags?: string[]; writeReceipt?: boolean } = {},
    ): Promise<ScopeMigratePlan | import("./scope-migrate.js").ScopeMigrateReceipt> {
      const config = deps.getConfig();
      const plan = buildScopeMigratePlan({
        cwd,
        config,
        projectBankId: deps.getProjectBankId(),
        ...(options.bankTags ? { bankTags: options.bankTags } : {}),
      });
      if (options.writeReceipt === false) return plan;
      return writeScopeMigrateReceipt(cwd, plan);
    },
  };
}
