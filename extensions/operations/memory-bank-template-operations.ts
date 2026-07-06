import {
  getBuiltInBankTemplate,
  listBuiltInBankTemplates,
  resolveBankTemplateManifest,
} from "../banks/bank-templates.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";

export function createBankTemplateOperations(deps: MemoryOperationsDeps) {
  return {
    listBankTemplates() {
      return listBuiltInBankTemplates();
    },

    async applyBankTemplate(args: { templateId: string; dryRun?: boolean }) {
      const template = getBuiltInBankTemplate(args.templateId);
      if (!template) {
        throw new Error(
          `Unknown bank template id: ${args.templateId}. Run /hindsight:templates to list ids.`,
        );
      }
      const client = deps.getClient();
      if (!client.importBankTemplate) {
        throw new Error("Hindsight client does not support bank template import.");
      }
      const config = deps.getConfig();
      // Each bundled template already declares which bank kind it targets, so apply resolves
      // that bank directly instead of taking a separate --bank override.
      const bankId = resolveOperationBank({
        requestedBank: template.target === "user" ? "global" : undefined,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const bankMissionSettings =
        template.target === "user" ? config.banks.user : config.banks.project;
      const manifest = resolveBankTemplateManifest(template, bankMissionSettings);
      const dryRun = args.dryRun ?? true;
      const result = await client.importBankTemplate(bankId, manifest, { dryRun });
      return { bankId, template, dryRun, result };
    },
  };
}
