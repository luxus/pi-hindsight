import { keyText, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { MemoryOperations } from "../operations/memory-operation-service.js";

type ToolTextResponse<Details> = {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
};

type ToolTextContent = { type: string; text?: string };

export const DEFAULT_COLLAPSED_TOOL_RESULT_LINES = 12;

export type NormalizedToolText = {
  text: string;
  hiddenLineCount: number;
  totalLineCount: number;
  canFold: boolean;
};

export type RetainToolResult = Awaited<ReturnType<MemoryOperations["retainExplicit"]>>;

export function normalizeToolResultText(
  text: string,
  expanded: boolean,
  maxLines = DEFAULT_COLLAPSED_TOOL_RESULT_LINES,
): NormalizedToolText {
  const lines = text.split("\n");
  const canFold = lines.length > maxLines;
  const hiddenLineCount = canFold && !expanded ? lines.length - maxLines : 0;
  return {
    text: hiddenLineCount > 0 ? lines.slice(0, maxLines).join("\n") : text,
    hiddenLineCount,
    totalLineCount: lines.length,
    canFold,
  };
}

function renderFoldHint(normalized: NormalizedToolText, theme: Theme) {
  if (!normalized.canFold) return "";
  if (normalized.hiddenLineCount > 0) {
    const plural = normalized.hiddenLineCount === 1 ? "" : "s";
    return `\n${theme.fg("muted", `... ${normalized.hiddenLineCount} more line${plural} (`)}${theme.fg(
      "dim",
      keyText("app.tools.expand"),
    )}${theme.fg("muted", " to expand)")}`;
  }
  return `\n${theme.fg("muted", "(")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg(
    "muted",
    " to collapse)",
  )}`;
}

export function renderMemoryToolTextResult(
  result: { content: ToolTextContent[] },
  options: Pick<ToolRenderResultOptions, "expanded">,
  theme: Theme,
) {
  const rawText = result.content.find((part) => part.type === "text")?.text ?? "";
  const normalized = normalizeToolResultText(rawText, options.expanded);
  const text = normalized.text || theme.fg("dim", "(no text output)");
  return new Text(`${text}${renderFoldHint(normalized, theme)}`, 0, 0);
}

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
