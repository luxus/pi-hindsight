import { listBuiltInBankTemplates } from "../banks/bank-templates.js";
import type { createMemoryOperations } from "../operations/memory-operation-service.js";
import type { CommandOperation } from "../operations/operation-catalog.js";
import { redactError } from "../utils/sanitize.js";
import {
  renderBankTemplateApplyResult,
  renderBankTemplateList,
  renderBankTemplateMentalModelDetails,
} from "./bank-template-presentation.js";
import { argList, completeFlags, completeValues, firstNonFlagArg } from "./command-utils.js";

type Operations = ReturnType<typeof createMemoryOperations>;
type ApplyBankTemplateResult = Awaited<ReturnType<Operations["applyBankTemplate"]>>;

function templateIds(): string[] {
  return listBuiltInBankTemplates().map((template) => template.id);
}

async function confirmTemplateApply(
  ctx: { ui: { select: (prompt: string, options: string[]) => Promise<string | undefined> } },
  preview: ApplyBankTemplateResult,
): Promise<boolean> {
  // Show the model name, source query, and tags before submission, per
  // docs/starter-mental-model-suggestions.md's product rules.
  const details = renderBankTemplateMentalModelDetails(preview.template);
  const summary = renderBankTemplateApplyResult(preview);
  const action = await ctx.ui.select(
    `${details ? `${details}\n\n` : ""}${summary}\n\nThis will write bank config and create/update mental models in Hindsight. Continue?`,
    ["Apply", "Cancel"],
  );
  return action === "Apply";
}

export function templateCommandOperations(operations: Operations): CommandOperation[] {
  return [
    {
      name: "hindsight:templates",
      spec: {
        description: "List bundled Hindsight bank templates.",
        handler: async (_args, ctx) => {
          ctx.ui.notify(renderBankTemplateList(operations.listBankTemplates()), "info");
        },
      },
    },
    {
      name: "hindsight:template-apply",
      spec: {
        description:
          "Apply a bundled Hindsight bank template: writes bank config and creates/updates mental models. Defaults to a dry-run preview with confirmation before writing.",
        getArgumentCompletions: (prefix) =>
          completeValues(prefix, templateIds()) ?? completeFlags(prefix, ["--dry-run"]),
        handler: async (args, ctx) => {
          const templateId = firstNonFlagArg(args);
          if (!templateId) {
            ctx.ui.notify(
              `Usage: /hindsight:template-apply <id> [--dry-run]. Known ids: ${templateIds().join(", ")}`,
              "warning",
            );
            return;
          }
          const dryRun = argList(args).some((flag) => flag === "--dry-run" || flag === "--preview");
          try {
            const preview = await operations.applyBankTemplate({ templateId, dryRun: true });
            if (dryRun) {
              const details = renderBankTemplateMentalModelDetails(preview.template);
              ctx.ui.notify(
                `${details ? `${details}\n\n` : ""}${renderBankTemplateApplyResult(preview)}`,
                "info",
              );
              return;
            }
            if (!(await confirmTemplateApply(ctx, preview))) {
              ctx.ui.notify("Hindsight bank template apply cancelled.", "warning");
              return;
            }
            const result = await operations.applyBankTemplate({ templateId, dryRun: false });
            ctx.ui.notify(renderBankTemplateApplyResult(result), "info");
          } catch (error) {
            ctx.ui.notify(`Hindsight bank template apply failed: ${redactError(error)}`, "warning");
          }
        },
      },
    },
  ];
}
