import { isRecord } from "./client-rest.js";

export interface MentalModelSummary {
  id: string;
  name: string;
  bankId?: string;
  sourceQuery?: string | null;
  content?: string | null;
  tags: string[];
  lastRefreshedAt?: string | null;
  createdAt?: string | null;
  isStale?: boolean | null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function booleanValue(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

function tagsValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

export function mentalModelFromUnknown(value: unknown): MentalModelSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return undefined;
  const bankId = stringValue(value.bank_id);
  const sourceQuery = nullableString(value.source_query);
  const content = nullableString(value.content);
  const lastRefreshedAt = nullableString(value.last_refreshed_at);
  const createdAt = nullableString(value.created_at);
  const isStale = booleanValue(value.is_stale);
  return {
    id,
    name,
    ...(bankId !== undefined ? { bankId } : {}),
    ...(sourceQuery !== undefined ? { sourceQuery } : {}),
    ...(content !== undefined ? { content } : {}),
    tags: tagsValue(value.tags),
    ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(isStale !== undefined ? { isStale } : {}),
  };
}

export function mentalModelListFromUnknown(value: unknown): MentalModelSummary[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    const model = mentalModelFromUnknown(item);
    return model ? [model] : [];
  });
}

export function mentalModelOption(model: MentalModelSummary): string {
  const tags = model.tags.length ? ` tags=${model.tags.join(",")}` : "";
  const stale = model.isStale ? " stale" : "";
  return `${model.name} (${model.id})${tags}${stale}`;
}

export function mentalModelWebInterfaceHint(baseUrl: string): string {
  return `Pi mental model view is read-only. Use the Hindsight web interface for create, edit, refresh, or delete: ${baseUrl}`;
}

export function renderMentalModel(model: MentalModelSummary, webHint?: string): string {
  const lines = [
    `Mental model ${model.name} (${model.id})`,
    `Bank: ${model.bankId ?? "unknown"}`,
    `Tags: ${model.tags.join(",") || "none"}`,
    `Last refresh: ${model.lastRefreshedAt ?? "never"}`,
    `Stale: ${model.isStale === undefined || model.isStale === null ? "unknown" : model.isStale ? "yes" : "no"}`,
  ];
  if (model.sourceQuery) lines.push(`Source query: ${model.sourceQuery}`);
  if (webHint) lines.push("", webHint);
  if (model.content) lines.push("", model.content);
  return lines.join("\n");
}

export function renderMentalModelHistory(value: unknown, webHint?: string): string {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length === 0) {
    return "Mental model history: none";
  }
  const lines = ["Mental model history"];
  for (const item of value.items.slice(0, 5)) {
    if (!isRecord(item)) continue;
    const id = stringValue(item.id) ?? stringValue(item.version_id) ?? "unknown";
    const createdAt =
      stringValue(item.created_at) ?? stringValue(item.refreshed_at) ?? "unknown time";
    const status = stringValue(item.status);
    lines.push(`- ${id} at ${createdAt}${status ? ` status=${status}` : ""}`);
  }
  if (webHint) lines.push("", webHint);
  return lines.length > 1 ? lines.join("\n") : "Mental model history: none";
}

export function renderMentalModelOperationResult(value: unknown): string {
  if (!isRecord(value)) return JSON.stringify(value);
  const operationId = stringValue(value.operation_id);
  const status = stringValue(value.status);
  if (operationId) return `operation=${operationId}${status ? ` status=${status}` : ""}`;
  return JSON.stringify(value);
}
