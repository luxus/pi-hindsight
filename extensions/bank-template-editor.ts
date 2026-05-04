import {
  cloneBankTemplateManifest,
  type BankTemplateManifest,
  type BankTemplateMentalModel,
} from "./bank-template-catalog.js";

export type BankTemplateBankFieldId =
  | "retain_mission"
  | "retain_extraction_mode"
  | "retain_custom_instructions"
  | "enable_observations"
  | "observations_mission"
  | "reflect_mission"
  | "disposition_skepticism"
  | "disposition_literalism"
  | "disposition_empathy";

export type BankTemplateMentalModelFieldName =
  | "id"
  | "name"
  | "source_query"
  | "tags"
  | "max_tokens"
  | "trigger.mode"
  | "trigger.refresh_after_consolidation";

export type BankTemplateEditorFieldId =
  | BankTemplateBankFieldId
  | `mental_models.${number}.${BankTemplateMentalModelFieldName}`;

export interface BankTemplateEditorField {
  id: BankTemplateEditorFieldId;
  label: string;
  value: string;
  kind: "text" | "select" | "boolean" | "integer";
  choices?: string[];
  advanced?: boolean;
}

const FIELD_LABELS: Record<BankTemplateBankFieldId, string> = {
  retain_mission: "Retain mission",
  retain_extraction_mode: "Retain extraction mode",
  retain_custom_instructions: "Custom retain instructions",
  enable_observations: "Enable observations",
  observations_mission: "Observations mission",
  reflect_mission: "Reflect mission",
  disposition_skepticism: "Disposition skepticism",
  disposition_literalism: "Disposition literalism",
  disposition_empathy: "Disposition empathy",
};

const FIELD_KINDS: Record<BankTemplateBankFieldId, BankTemplateEditorField["kind"]> = {
  retain_mission: "text",
  retain_extraction_mode: "select",
  retain_custom_instructions: "text",
  enable_observations: "boolean",
  observations_mission: "text",
  reflect_mission: "text",
  disposition_skepticism: "integer",
  disposition_literalism: "integer",
  disposition_empathy: "integer",
};

const BASIC_FIELDS: readonly BankTemplateBankFieldId[] = [
  "retain_mission",
  "retain_extraction_mode",
  "retain_custom_instructions",
  "enable_observations",
  "observations_mission",
  "reflect_mission",
  "disposition_skepticism",
  "disposition_literalism",
  "disposition_empathy",
];

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseBankFieldValue(fieldId: BankTemplateBankFieldId, value: string): unknown {
  if (fieldId === "enable_observations") return value === "true";
  if (fieldId.startsWith("disposition_")) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new Error(`${FIELD_LABELS[fieldId]} must be an integer from 1 to 5.`);
    }
    return parsed;
  }
  if (fieldId === "retain_extraction_mode") {
    if (!["", "concise", "verbose", "custom", "chunks"].includes(value)) {
      throw new Error("Retain extraction mode must be concise, verbose, custom, or chunks.");
    }
    return value || undefined;
  }
  return value;
}

function buildBankEditorFields(manifest: BankTemplateManifest): BankTemplateEditorField[] {
  const bank = manifest.bank ?? {};
  return BASIC_FIELDS.map((id) => ({
    id,
    label: FIELD_LABELS[id],
    value: stringValue(bank[id]),
    kind: FIELD_KINDS[id],
    ...(id === "retain_extraction_mode"
      ? { choices: ["", "concise", "verbose", "custom", "chunks"] }
      : {}),
    ...(id === "retain_custom_instructions" || id.startsWith("disposition_")
      ? { advanced: true }
      : {}),
  }));
}

function mentalModelEditorFields(manifest: BankTemplateManifest): BankTemplateEditorField[] {
  return (manifest.mental_models ?? []).flatMap((model, index) => {
    const label = model.name || model.id || `#${index + 1}`;
    const trigger = model.trigger ?? {};
    return [
      {
        id: `mental_models.${index}.id` as const,
        label: `Mental model ${label} id`,
        value: stringValue(model.id),
        kind: "text" as const,
      },
      {
        id: `mental_models.${index}.name` as const,
        label: `Mental model ${label} name`,
        value: stringValue(model.name),
        kind: "text" as const,
      },
      {
        id: `mental_models.${index}.source_query` as const,
        label: `Mental model ${label} source query`,
        value: stringValue(model.source_query),
        kind: "text" as const,
      },
      {
        id: `mental_models.${index}.tags` as const,
        label: `Mental model ${label} tags`,
        value: Array.isArray(model.tags) ? model.tags.join(", ") : stringValue(model.tags),
        kind: "text" as const,
        advanced: true,
      },
      {
        id: `mental_models.${index}.max_tokens` as const,
        label: `Mental model ${label} max tokens`,
        value: stringValue(model.max_tokens),
        kind: "integer" as const,
      },
      {
        id: `mental_models.${index}.trigger.mode` as const,
        label: `Mental model ${label} trigger mode`,
        value: stringValue(trigger.mode),
        kind: "select" as const,
        choices: ["", "full", "incremental"],
        advanced: true,
      },
      {
        id: `mental_models.${index}.trigger.refresh_after_consolidation` as const,
        label: `Mental model ${label} refresh after consolidation`,
        value: stringValue(trigger.refresh_after_consolidation),
        kind: "boolean" as const,
        choices: ["", "true", "false"],
        advanced: true,
      },
    ];
  });
}

export function buildBankTemplateEditorFields(
  manifest: BankTemplateManifest,
): BankTemplateEditorField[] {
  return [...buildBankEditorFields(manifest), ...mentalModelEditorFields(manifest)];
}

function parseMentalModelFieldValue(
  fieldName: BankTemplateMentalModelFieldName,
  value: string,
): unknown {
  if (fieldName === "tags") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (fieldName === "max_tokens") {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 256 || parsed > 8192) {
      throw new Error("Mental model max tokens must be an integer from 256 to 8192.");
    }
    return parsed;
  }
  if (fieldName === "trigger.refresh_after_consolidation") {
    if (!value) return undefined;
    if (value !== "true" && value !== "false") {
      throw new Error("Mental model refresh after consolidation must be true or false.");
    }
    return value === "true";
  }
  if (fieldName === "trigger.mode") {
    if (!value) return undefined;
    if (value !== "full" && value !== "incremental") {
      throw new Error("Mental model trigger mode must be full or incremental.");
    }
    return value;
  }
  return value;
}

function parseMentalModelFieldId(
  fieldId: BankTemplateEditorFieldId,
): { index: number; fieldName: BankTemplateMentalModelFieldName } | undefined {
  const match = /^mental_models\.(\d+)\.(.+)$/.exec(fieldId);
  if (!match) return undefined;
  return {
    index: Number(match[1]),
    fieldName: match[2] as BankTemplateMentalModelFieldName,
  };
}

function isBankEditorFieldId(
  fieldId: BankTemplateEditorFieldId,
): fieldId is BankTemplateBankFieldId {
  return !fieldId.startsWith("mental_models.");
}

export function updateBankTemplateField(
  manifest: BankTemplateManifest,
  fieldId: BankTemplateEditorFieldId,
  value: string,
): BankTemplateManifest {
  const next = cloneBankTemplateManifest(manifest);
  const mentalField = parseMentalModelFieldId(fieldId);
  if (mentalField) {
    next.mental_models = [...(next.mental_models ?? [])];
    const model = { ...next.mental_models[mentalField.index] } as BankTemplateMentalModel;
    const parsed = parseMentalModelFieldValue(mentalField.fieldName, value);
    if (mentalField.fieldName.startsWith("trigger.")) {
      const triggerKey = mentalField.fieldName.slice("trigger.".length);
      model.trigger = { ...model.trigger };
      if (parsed === undefined || parsed === "") delete model.trigger[triggerKey];
      else model.trigger[triggerKey] = parsed;
      if (Object.keys(model.trigger).length === 0) delete model.trigger;
    } else if (mentalField.fieldName === "id") {
      if (parsed === undefined || parsed === "")
        delete (model as Partial<BankTemplateMentalModel>).id;
      else model.id = parsed as string;
    } else if (mentalField.fieldName === "name") {
      if (parsed === undefined || parsed === "")
        delete (model as Partial<BankTemplateMentalModel>).name;
      else model.name = parsed as string;
    } else if (mentalField.fieldName === "source_query") {
      if (parsed === undefined || parsed === "")
        delete (model as Partial<BankTemplateMentalModel>).source_query;
      else model.source_query = parsed as string;
    } else if (mentalField.fieldName === "tags") {
      if (parsed === undefined || (Array.isArray(parsed) && parsed.length === 0)) delete model.tags;
      else model.tags = parsed as string[];
    } else if (mentalField.fieldName === "max_tokens") {
      if (parsed === undefined || parsed === "") delete model.max_tokens;
      else model.max_tokens = parsed as number;
    }
    next.mental_models[mentalField.index] = model;
    return next;
  }

  if (!isBankEditorFieldId(fieldId)) return next;
  next.bank = { ...next.bank };
  const parsed = parseBankFieldValue(fieldId, value);
  if (parsed === undefined || parsed === "") delete next.bank[fieldId];
  else next.bank[fieldId] = parsed;
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mentalModelLabel(model: Record<string, unknown>, index: number): string {
  return stringField(model.id) || `#${index + 1}`;
}

export function validateMentalModel(model: unknown, index = 0): string[] {
  const errors: string[] = [];
  if (!isRecord(model)) return [`Mental model #${index + 1} must be an object.`];
  const id = stringField(model.id);
  const label = mentalModelLabel(model, index);
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push(
      `Mental model id ${JSON.stringify(model.id)} must be lowercase alphanumeric with hyphens.`,
    );
  }
  const name = stringField(model.name);
  if (!name?.trim()) errors.push(`Mental model ${label} name is required.`);
  const sourceQuery = stringField(model.source_query);
  if (!sourceQuery?.trim()) errors.push(`Mental model ${label} source query is required.`);
  if (model.max_tokens !== undefined) {
    const maxTokens = model.max_tokens;
    if (
      typeof maxTokens !== "number" ||
      !Number.isInteger(maxTokens) ||
      maxTokens < 256 ||
      maxTokens > 8192
    ) {
      errors.push(`Mental model ${label} max_tokens must be an integer from 256 to 8192.`);
    }
  }
  if (
    model.tags !== undefined &&
    (!Array.isArray(model.tags) || model.tags.some((tag) => typeof tag !== "string"))
  ) {
    errors.push(`Mental model ${label} tags must be an array of strings.`);
  }
  if (model.trigger !== undefined) {
    if (!isRecord(model.trigger)) {
      errors.push(`Mental model ${label} trigger must be an object.`);
    } else {
      if (
        model.trigger.refresh_after_consolidation !== undefined &&
        typeof model.trigger.refresh_after_consolidation !== "boolean"
      ) {
        errors.push(`Mental model ${label} trigger refresh_after_consolidation must be boolean.`);
      }
      if (
        model.trigger.mode !== undefined &&
        model.trigger.mode !== "full" &&
        model.trigger.mode !== "incremental"
      ) {
        errors.push(`Mental model ${label} trigger mode must be full or incremental.`);
      }
    }
  }
  return errors;
}

function validateDirectives(manifest: BankTemplateManifest): string[] {
  if (manifest.directives === undefined) return [];
  if (!Array.isArray(manifest.directives)) return ["directives must be an array."];
  return manifest.directives.flatMap((directive, index) => {
    if (!isRecord(directive)) return [`Directive #${index + 1} must be an object.`];
    const label = stringField(directive.name) || `#${index + 1}`;
    const errors: string[] = [];
    if (!stringField(directive.name)?.trim()) errors.push(`Directive ${label} name is required.`);
    if (!stringField(directive.content)?.trim()) {
      errors.push(`Directive ${label} content is required.`);
    }
    if (directive.priority !== undefined && !Number.isInteger(directive.priority)) {
      errors.push(`Directive ${label} priority must be an integer.`);
    }
    if (directive.is_active !== undefined && typeof directive.is_active !== "boolean") {
      errors.push(`Directive ${label} is_active must be boolean.`);
    }
    if (directive.tags !== undefined && !Array.isArray(directive.tags)) {
      errors.push(`Directive ${label} tags must be an array of strings.`);
    }
    return errors;
  });
}

export function validateBankTemplateManifestForEditing(manifest: BankTemplateManifest): string[] {
  const errors: string[] = [];
  if (manifest.bank !== undefined && !isRecord(manifest.bank))
    errors.push("bank must be an object.");
  if (manifest.mental_models !== undefined && !Array.isArray(manifest.mental_models)) {
    errors.push("mental_models must be an array.");
  }
  if (Array.isArray(manifest.mental_models)) {
    const seen = new Set<string>();
    manifest.mental_models.forEach((model, index) => {
      errors.push(...validateMentalModel(model, index));
      if (isRecord(model) && typeof model.id === "string") {
        if (seen.has(model.id)) errors.push(`Duplicate mental model id: ${model.id}.`);
        seen.add(model.id);
      }
    });
  }
  errors.push(...validateDirectives(manifest));
  return errors;
}

export function mentalModelTagWarnings(manifest: BankTemplateManifest): string[] {
  if (!Array.isArray(manifest.mental_models)) return [];
  return manifest.mental_models
    .filter((model) => isRecord(model) && Array.isArray(model.tags) && model.tags.length)
    .map((model) => {
      const tags = (model.tags as string[]).join(", ");
      return `Mental model ${String(model.id)} has tags (${tags}); refresh only reads memories with compatible tags.`;
    });
}
