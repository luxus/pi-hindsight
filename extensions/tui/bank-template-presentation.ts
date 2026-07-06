import type { BankTemplateImportResponse } from "@vectorize-io/hindsight-client";
import type { BuiltInBankTemplate } from "../banks/bank-templates.js";

export function renderBankTemplateList(templates: readonly BuiltInBankTemplate[]): string {
  const lines = templates.map((template) => {
    const mentalModels = template.manifest.mental_models?.length ?? 0;
    const directives = template.manifest.directives?.length ?? 0;
    return `- ${template.id} (${template.target}): ${template.label} — ${template.description} mentalModels=${mentalModels} directives=${directives}`;
  });
  return ["Hindsight bank templates:", ...lines].join("\n");
}

function summarizeImportResponse(result: unknown): string {
  if (typeof result !== "object" || !result) return JSON.stringify(result);
  const response = result as BankTemplateImportResponse;
  const created = response.mental_models_created?.length ?? 0;
  const updated = response.mental_models_updated?.length ?? 0;
  const directivesCreated = response.directives_created?.length ?? 0;
  const directivesUpdated = response.directives_updated?.length ?? 0;
  return `configApplied=${response.config_applied}; mentalModels created=${created}/updated=${updated}; directives created=${directivesCreated}/updated=${directivesUpdated}`;
}

export function renderBankTemplateApplyResult(args: {
  bankId: string;
  template: BuiltInBankTemplate;
  dryRun: boolean;
  result: unknown;
}): string {
  const prefix = args.dryRun
    ? `Bank template preview: ${args.template.id} -> ${args.bankId}`
    : `Applied bank template: ${args.template.id} -> ${args.bankId}`;
  return `${prefix}; ${summarizeImportResponse(args.result)}; write=${args.dryRun ? "no" : "yes"}`;
}

// Shows each mental model's name, source query, and tags before submission, per
// docs/starter-mental-model-suggestions.md's product rules.
export function renderBankTemplateMentalModelDetails(template: BuiltInBankTemplate): string {
  const models = template.manifest.mental_models ?? [];
  if (!models.length) return "";
  const lines = models.map(
    (model) =>
      `- ${model.name} (${model.id}); tags=${model.tags?.join(",") || "none"}; query=${model.source_query}`,
  );
  return [`Mental models for ${template.id} (${template.target} bank):`, ...lines].join("\n");
}
