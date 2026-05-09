import {
  bankConfigOverrideSummaryLines,
  exportedBankTemplateSummaryLines,
} from "./bank-settings-presenter.js";
import type { MemoryOperations } from "./memory-operation-service.js";

type ToolTextResponse<Details> = {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
};

export type RetainToolResult = Awaited<ReturnType<MemoryOperations["retainExplicit"]>>;
export type RouteMemoryToolResult = ReturnType<MemoryOperations["routeMemory"]>;
export type DeleteDocumentToolResult = Awaited<ReturnType<MemoryOperations["deleteDocument"]>>;
export type ConfigureToolResult = Awaited<ReturnType<MemoryOperations["configure"]>>;
export type ImportToolResult = Awaited<ReturnType<MemoryOperations["importSession"]>>;
export type ChatTranscriptImportToolResult = Awaited<
  ReturnType<MemoryOperations["importChatTranscript"]>
>;
export type ListDirectivesToolResult = Awaited<ReturnType<MemoryOperations["listDirectives"]>>;
export type GetDirectiveToolResult = Awaited<ReturnType<MemoryOperations["getDirective"]>>;
export type CreateDirectiveToolResult = Awaited<ReturnType<MemoryOperations["createDirective"]>>;
export type UpdateDirectiveToolResult = Awaited<ReturnType<MemoryOperations["updateDirective"]>>;
export type DeleteDirectiveToolResult = Awaited<ReturnType<MemoryOperations["deleteDirective"]>>;
export type GetBankTemplateSchemaToolResult = Awaited<
  ReturnType<MemoryOperations["getBankTemplateSchema"]>
>;
export type ExportBankTemplateToolResult = Awaited<
  ReturnType<MemoryOperations["exportBankTemplate"]>
>;
export type GetBankConfigToolResult = Awaited<ReturnType<MemoryOperations["getBankConfig"]>>;
export type UpdateBankConfigToolResult = Awaited<ReturnType<MemoryOperations["updateBankConfig"]>>;
export type ResetBankConfigToolResult = Awaited<ReturnType<MemoryOperations["resetBankConfig"]>>;
export type ImportBankTemplateToolResult = Awaited<
  ReturnType<MemoryOperations["importBankTemplate"]>
>;
export type RetainReceiptListResult = Awaited<ReturnType<MemoryOperations["listRetainReceipts"]>>;
export type ListOperationsToolResult = Awaited<ReturnType<MemoryOperations["listOperations"]>>;
export type OperationToolResult =
  | Awaited<ReturnType<MemoryOperations["cancelOperation"]>>
  | Awaited<ReturnType<MemoryOperations["retryOperation"]>>;
export type ListMemoriesToolResult = Awaited<ReturnType<MemoryOperations["listMemories"]>>;
export type MemoryToolResult = Awaited<ReturnType<MemoryOperations["getMemory"]>>;
export type ChunkToolResult = Awaited<ReturnType<MemoryOperations["getChunk"]>>;
export type ListDocumentsToolResult = Awaited<ReturnType<MemoryOperations["listDocuments"]>>;
export type DocumentToolResult = Awaited<ReturnType<MemoryOperations["getDocument"]>>;
export type UpdateDocumentTagsToolResult = Awaited<
  ReturnType<MemoryOperations["updateDocumentTags"]>
>;
export type ListEntitiesToolResult = Awaited<ReturnType<MemoryOperations["listEntities"]>>;
export type EntityToolResult = Awaited<ReturnType<MemoryOperations["getEntity"]>>;
export type RegenerateEntityToolResult = Awaited<ReturnType<MemoryOperations["regenerateEntity"]>>;
export type GraphToolResult = Awaited<ReturnType<MemoryOperations["getGraph"]>>;
export type EntityGraphToolResult = Awaited<ReturnType<MemoryOperations["getEntityGraph"]>>;
export type ListTagsToolResult = Awaited<ReturnType<MemoryOperations["listTags"]>>;
export type BankProfileToolResult = Awaited<ReturnType<MemoryOperations["getBankProfile"]>>;
export type UpdateBankProfileToolResult = Awaited<
  ReturnType<MemoryOperations["updateBankProfile"]>
>;
export type UpdateBankDispositionToolResult = Awaited<
  ReturnType<MemoryOperations["updateBankDisposition"]>
>;
export type AddBankBackgroundToolResult = Awaited<
  ReturnType<MemoryOperations["addBankBackground"]>
>;

export function retainToolResponse(result: RetainToolResult): ToolTextResponse<RetainToolResult> {
  const deadLetterStatus = result.deadLettered
    ? ` ${result.deadLettered} job${result.deadLettered === 1 ? "" : "s"} moved to dead-letter queue; run /hindsight to inspect.`
    : "";
  const text =
    result.remaining > 0
      ? `Queued for ${result.bankId}; ${result.remaining} job${result.remaining === 1 ? "" : "s"} pending.${deadLetterStatus}`
      : `Retained in ${result.bankId} as ${result.documentId}.${deadLetterStatus}`;
  const operationText = result.operationIds?.length
    ? ` Operation IDs: ${result.operationIds.join(", ")}.`
    : "";
  return { content: [{ type: "text", text: `${text}${operationText}` }], details: result };
}

export function routeMemoryToolResponse(
  result: RouteMemoryToolResult,
): ToolTextResponse<RouteMemoryToolResult> {
  const targetText = result.targets.length
    ? result.targets
        .map(
          (target) =>
            `${target.bankRole}:${target.bankId} tags=${target.tags.join(",") || "none"} ${target.willWrite ? "will-write" : "preview-only"}`,
        )
        .join("; ")
    : "none";
  const writeText = result.writes.length ? result.writes.join(",") : "none";
  const safetyText = result.safetyNotes.length ? result.safetyNotes.join("; ") : "none";
  return {
    content: [
      {
        type: "text",
        text: [
          `Route ${result.route} confidence=${result.confidence}; ${result.reason}`,
          `Targets: ${targetText}`,
          `Writes now: ${writeText}`,
          `Safety: ${safetyText}`,
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function deleteDocumentToolResponse(
  result: DeleteDocumentToolResult,
): ToolTextResponse<DeleteDocumentToolResult> {
  return {
    content: [
      {
        type: "text",
        text: `Deleted document ${result.documentId} from ${result.bankId}.`,
      },
    ],
    details: result,
  };
}

export function configureToolResponse(
  result: ConfigureToolResult,
): ToolTextResponse<{ path: string; projectBankId: string }> {
  return {
    content: [
      {
        type: "text",
        text: `Wrote ${result.path}\nProject bank: ${result.projectBankId}\nRun /hindsight to verify.`,
      },
    ],
    details: { path: result.path, projectBankId: result.projectBankId },
  };
}

export function chatTranscriptImportToolResponse(
  result: ChatTranscriptImportToolResult,
): ToolTextResponse<ChatTranscriptImportToolResult> {
  const dropped = result.droppedEventTypes.length
    ? result.droppedEventTypes.map((event) => `${event.type}:${event.count}`).join(", ")
    : "none";
  const text = result.skipped
    ? `Chat transcript import skipped: ${result.skipReason}; dropped=${result.droppedEventCount} (${dropped}); malformed=${result.malformedLineCount}.`
    : result.dryRun
      ? `Chat transcript import preview: kept=${result.keptEventCount}; turns=${result.retainedTurnCount}; dropped=${result.droppedEventCount} (${dropped}); malformed=${result.malformedLineCount}; bank=${result.bankId}; document=${result.documentId}.`
      : `Imported chat transcript into ${result.bankId} as ${result.documentId}; kept=${result.keptEventCount}; dropped=${result.droppedEventCount}.`;
  return { content: [{ type: "text", text }], details: result };
}

export function importToolResponse(result: ImportToolResult): ToolTextResponse<ImportToolResult> {
  const documentLabel = `document${result.documents.length === 1 ? "" : "s"}`;
  const text = result.dryRun
    ? `Import preview: ${result.messageCount} messages would write ${result.documents.length} ${documentLabel} to ${result.bankId}. First document: ${result.documentId}. Manifest unchanged: ${result.manifestPath}.`
    : `Imported ${result.messageCount} messages into ${result.bankId} as ${result.documentId}. Manifest: ${result.manifestPath}.`;
  return { content: [{ type: "text", text }], details: result };
}

function directiveItems(result: unknown): unknown[] {
  if (typeof result !== "object" || !result || Array.isArray(result)) return [];
  const items = (result as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function directiveLabel(value: unknown): string {
  if (typeof value !== "object" || !value || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "unknown";
  const name = typeof record.name === "string" ? record.name : "unnamed";
  const active =
    typeof record.is_active === "boolean" ? (record.is_active ? "active" : "inactive") : "unknown";
  const priority = typeof record.priority === "number" ? record.priority : 0;
  return `${name} (${id}) · ${active} · priority ${priority}`;
}

export function listDirectivesToolResponse(
  result: ListDirectivesToolResult,
): ToolTextResponse<ListDirectivesToolResult> {
  const items = directiveItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [
          `Directives in ${result.bankId}: ${items.length}`,
          ...items.map(directiveLabel),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function getDirectiveToolResponse(
  result: GetDirectiveToolResult,
): ToolTextResponse<GetDirectiveToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Directive ${result.directiveId} in ${result.bankId}.`,
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function createDirectiveToolResponse(
  result: CreateDirectiveToolResult,
): ToolTextResponse<CreateDirectiveToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Created directive in ${result.bankId}.`,
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function updateDirectiveToolResponse(
  result: UpdateDirectiveToolResult,
): ToolTextResponse<UpdateDirectiveToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Updated directive ${result.directiveId} in ${result.bankId}.`,
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function deleteDirectiveToolResponse(
  result: DeleteDirectiveToolResult,
): ToolTextResponse<DeleteDirectiveToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Deleted directive ${result.directiveId} in ${result.bankId}.`,
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

function objectItems(result: unknown): unknown[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.memories)) return record.memories;
  if (Array.isArray(record.operations)) return record.operations;
  return [];
}

function textField(record: Record<string, unknown>, keys: string[], fallback = "unknown"): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.length;
  }
  return undefined;
}

function payloadSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "payload unavailable";
  const record = value as Record<string, unknown>;
  const payload = record.payload ?? record.request ?? record.input;
  if (!payload || typeof payload !== "object") return "payload unavailable";
  return (
    Object.keys(payload as Record<string, unknown>)
      .slice(0, 8)
      .join(", ") || "payload empty"
  );
}

function operationLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const documentIds = record.document_ids ?? record.documentIds ?? record.document_id;
  const docs = Array.isArray(documentIds)
    ? documentIds.join(",")
    : typeof documentIds === "string"
      ? documentIds
      : "unknown";
  const items = numberField(record, ["items_count", "itemsCount", "item_count", "items"]);
  const error = textField(record, ["error", "error_message", "message"], "none");
  const created = textField(record, ["created_at", "createdAt"], "unknown-created");
  const updated = textField(
    record,
    ["updated_at", "updatedAt", "completed_at", "completedAt"],
    "unknown-updated",
  );
  return `${textField(record, ["id", "operation_id", "operationId"])} · ${textField(record, ["status"])} · ${textField(record, ["task_type", "taskType", "type"])} · docs=${docs} · items=${items ?? "unknown"} · error=${error} · ${created}→${updated} · ${payloadSummary(value)}`;
}

export function listOperationsToolResponse(
  result: ListOperationsToolResult,
): ToolTextResponse<ListOperationsToolResult> {
  const items = objectItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [
          `Operations in ${result.bankId}: ${items.length}`,
          ...items.map(operationLabel),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function operationToolResponse(
  verb: "Cancelled" | "Retried",
  result: OperationToolResult,
): ToolTextResponse<OperationToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `${verb} operation ${result.operationId} in ${result.bankId}.`,
          operationLabel(result.result),
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

function memoryLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const text = textField(record, ["content", "text", "summary"], "").slice(0, 120);
  return `${textField(record, ["id", "memory_id", "memoryId"])} · ${textField(record, ["type", "fact_type", "factType"])} · ${text}`;
}

function arrayField(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.map(String);
  }
  return [];
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return undefined;
}

function documentLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const metadata =
    nestedRecord(record.document_metadata) ??
    nestedRecord(record.documentMetadata) ??
    nestedRecord(record.metadata) ??
    nestedRecord(record.provenance);
  const metadataKeys = metadata ? Object.keys(metadata).slice(0, 6).join(",") : "none";
  const tags = arrayField(record, ["tags", "document_tags", "documentTags"]);
  const counts = [
    numberField(record, ["item_count", "itemCount", "items", "chunks"]),
    numberField(record, [
      "memory_unit_count",
      "memoryUnitCount",
      "memory_count",
      "memoryCount",
      "memories",
    ]),
  ];
  return `${textField(record, ["id", "document_id", "documentId"])} · tags=${tags.join(",") || "none"} · metadata=${metadataKeys} · items=${counts[0] ?? "?"} · memories=${counts[1] ?? "?"} · ${textField(record, ["created_at", "createdAt"], "unknown-created")}→${textField(record, ["updated_at", "updatedAt"], "unknown-updated")}`;
}

function entityLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `${textField(record, ["id", "entity_id", "entityId"])} · ${textField(record, ["canonical_name", "canonicalName", "text", "name", "label"])} · ${textField(record, ["type", "entity_type", "entityType"])} · count=${numberField(record, ["mention_count", "mentionCount", "count", "memory_count", "memories"]) ?? "?"}`;
}

function graphSummary(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return [JSON.stringify(result)];
  const record = result as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes)
    ? record.nodes.length
    : numberField(record, ["node_count", "nodeCount"]);
  const edges = Array.isArray(record.edges)
    ? record.edges.length
    : numberField(record, ["edge_count", "edgeCount"]);
  return [
    `nodes=${nodes ?? "?"}; edges=${edges ?? "?"}`,
    JSON.stringify(result, null, 2).slice(0, 4000),
  ];
}

function tagLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `${textField(record, ["tag", "name", "id"])} · count=${numberField(record, ["count", "memory_count", "document_count"]) ?? "?"}`;
}

export function listMemoriesToolResponse(
  result: ListMemoriesToolResult,
): ToolTextResponse<ListMemoriesToolResult> {
  const items = objectItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [`Memories in ${result.bankId}: ${items.length}`, ...items.map(memoryLabel)].join(
          "\n",
        ),
      },
    ],
    details: result,
  };
}

export function listDocumentsToolResponse(
  result: ListDocumentsToolResult,
): ToolTextResponse<ListDocumentsToolResult> {
  const items = objectItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [`Documents in ${result.bankId}: ${items.length}`, ...items.map(documentLabel)].join(
          "\n",
        ),
      },
    ],
    details: result,
  };
}

export function documentToolResponse(
  heading: string,
  result: DocumentToolResult | UpdateDocumentTagsToolResult,
): ToolTextResponse<DocumentToolResult | UpdateDocumentTagsToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          heading,
          documentLabel(result.result),
          JSON.stringify(result.result, null, 2).slice(0, 4000),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function listEntitiesToolResponse(
  result: ListEntitiesToolResult,
): ToolTextResponse<ListEntitiesToolResult> {
  const items = objectItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [`Entities in ${result.bankId}: ${items.length}`, ...items.map(entityLabel)].join(
          "\n",
        ),
      },
    ],
    details: result,
  };
}

export function entityToolResponse(
  heading: string,
  result: EntityToolResult | RegenerateEntityToolResult,
): ToolTextResponse<EntityToolResult | RegenerateEntityToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          heading,
          entityLabel(result.result),
          JSON.stringify(result.result, null, 2).slice(0, 4000),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function graphToolResponse(
  heading: string,
  result: GraphToolResult | EntityGraphToolResult,
): ToolTextResponse<GraphToolResult | EntityGraphToolResult> {
  return {
    content: [{ type: "text", text: [heading, ...graphSummary(result.result)].join("\n") }],
    details: result,
  };
}

export function listTagsToolResponse(
  result: ListTagsToolResult,
): ToolTextResponse<ListTagsToolResult> {
  const items = objectItems(result.result);
  return {
    content: [
      {
        type: "text",
        text: [`Tags in ${result.bankId}: ${items.length}`, ...items.map(tagLabel)].join("\n"),
      },
    ],
    details: result,
  };
}

export function bankProfileToolResponse(
  heading: string,
  result:
    | BankProfileToolResult
    | UpdateBankProfileToolResult
    | UpdateBankDispositionToolResult
    | AddBankBackgroundToolResult,
): ToolTextResponse<
  | BankProfileToolResult
  | UpdateBankProfileToolResult
  | UpdateBankDispositionToolResult
  | AddBankBackgroundToolResult
> {
  return {
    content: [
      {
        type: "text",
        text: [heading, JSON.stringify(result.result, null, 2).slice(0, 4000)].join("\n"),
      },
    ],
    details: result,
  };
}

export function jsonToolResponse<T extends { result: unknown }>(
  heading: string,
  result: T,
): ToolTextResponse<T> {
  return {
    content: [{ type: "text", text: [heading, JSON.stringify(result.result, null, 2)].join("\n") }],
    details: result,
  };
}

function schemaSummary(schema: unknown): string {
  if (typeof schema !== "object" || !schema || Array.isArray(schema))
    return "Schema fields: unavailable";
  const record = schema as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "Bank template schema";
  const properties = record.properties;
  const propertyCount =
    typeof properties === "object" && properties && !Array.isArray(properties)
      ? Object.keys(properties).length
      : 0;
  return `${title}; top-level fields: ${propertyCount}`;
}

export function getBankTemplateSchemaToolResponse(
  result: GetBankTemplateSchemaToolResult,
): ToolTextResponse<GetBankTemplateSchemaToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          "Fetched Hindsight bank template JSON Schema.",
          schemaSummary(result.schema),
          JSON.stringify(result.schema, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function getBankConfigToolResponse(
  result: GetBankConfigToolResult,
): ToolTextResponse<GetBankConfigToolResult> {
  return {
    content: [
      {
        type: "text",
        text: [
          `Read bank config for ${result.bankId}.`,
          bankConfigOverrideSummaryLines(result.result).join("; "),
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

function bankConfigChangeSummary(result: { before?: unknown; after?: unknown }): {
  before: string;
  after: string;
} {
  return {
    before: result.before
      ? bankConfigOverrideSummaryLines(result.before).join("; ")
      : "unavailable",
    after: result.after ? bankConfigOverrideSummaryLines(result.after).join("; ") : "unavailable",
  };
}

export function updateBankConfigToolResponse(
  result: UpdateBankConfigToolResult,
): ToolTextResponse<UpdateBankConfigToolResult> {
  const summary = bankConfigChangeSummary(result);
  return {
    content: [
      {
        type: "text",
        text: [
          `Updated bank config overrides for ${result.bankId}.`,
          `Updated fields: ${Object.keys(result.updates).length}`,
          `Before: ${summary.before}`,
          `After: ${summary.after}`,
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function resetBankConfigToolResponse(
  result: ResetBankConfigToolResult,
): ToolTextResponse<ResetBankConfigToolResult> {
  const summary = bankConfigChangeSummary(result);
  return {
    content: [
      {
        type: "text",
        text: [
          `Reset bank config overrides for ${result.bankId}.`,
          `Before: ${summary.before}`,
          `After: ${summary.after}`,
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function importBankTemplateToolResponse(
  result: ImportBankTemplateToolResult,
): ToolTextResponse<ImportBankTemplateToolResult> {
  const mode = result.dryRun ? "Previewed" : "Imported";
  return {
    content: [
      {
        type: "text",
        text: [
          `${mode} bank template for ${result.bankId}.`,
          summarizeImportResult(result.result),
          JSON.stringify(result.result, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

function summarizeImportResult(result: unknown): string {
  if (typeof result !== "object" || !result || Array.isArray(result))
    return "Import result: unavailable";
  const record = result as Record<string, unknown>;
  const preferred = [
    "dry_run",
    "config_applied",
    "mental_models_created",
    "mental_models_updated",
    "directives_created",
    "directives_updated",
    "operation_ids",
  ];
  const lines = preferred
    .filter((key) => key in record)
    .map((key) => `${key}: ${JSON.stringify(record[key])}`);
  return lines.length ? lines.join("; ") : "Import result fields: unknown";
}

export function exportBankTemplateToolResponse(
  result: ExportBankTemplateToolResult,
): ToolTextResponse<ExportBankTemplateToolResult> {
  const summary = exportedBankTemplateSummaryLines(result.manifest).join("; ");
  return {
    content: [
      {
        type: "text",
        text: [
          `Exported bank template from ${result.bankId}.`,
          ...(result.outputPath ? [`Saved manifest: ${result.outputPath}`] : []),
          summary,
          JSON.stringify(result.manifest, null, 2),
        ].join("\n"),
      },
    ],
    details: result,
  };
}

export function retainReceiptListToolResponse(
  result: RetainReceiptListResult,
): ToolTextResponse<RetainReceiptListResult> {
  const lines = result.map(
    (receipt, index) =>
      `${index + 1}. ${receipt.createdAt} ${receipt.bankId} ${receipt.documentId} (${receipt.updateMode})`,
  );
  return {
    content: [{ type: "text", text: lines.length ? lines.join("\n") : "No retain receipts." }],
    details: result,
  };
}
