import { keyText, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { MemoryOperations } from "../operations/memory-operation-service.js";

type ToolTextResponse<Details> = {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
};

type ToolTextContent = { type: string; text?: string };

export const DEFAULT_COLLAPSED_TOOL_RESULT_LINES = 12;

export type CollapsedToolText = {
  text: string;
  hiddenLineCount: number;
};

export type RetainToolResult = Awaited<ReturnType<MemoryOperations["retainExplicit"]>>;

export function collapseToolResultText(
  text: string,
  expanded: boolean,
  maxLines = DEFAULT_COLLAPSED_TOOL_RESULT_LINES,
): CollapsedToolText {
  const lines = text.split("\n");
  if (expanded || lines.length <= maxLines) return { text, hiddenLineCount: 0 };
  return {
    text: lines.slice(0, maxLines).join("\n"),
    hiddenLineCount: lines.length - maxLines,
  };
}

export function renderMemoryToolTextResult(
  result: { content: ToolTextContent[] },
  options: Pick<ToolRenderResultOptions, "expanded">,
  theme: Theme,
) {
  const rawText = result.content.find((part) => part.type === "text")?.text ?? "";
  const collapsed = collapseToolResultText(rawText, options.expanded);
  const text = collapsed.text || theme.fg("dim", "(no text output)");

  if (collapsed.hiddenLineCount > 0) {
    return new Text(
      `${text}\n${theme.fg(
        "muted",
        `... ${collapsed.hiddenLineCount} more line${collapsed.hiddenLineCount === 1 ? "" : "s"} (`,
      )}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand)")}`,
      0,
      0,
    );
  }

  if (options.expanded && rawText.split("\n").length > DEFAULT_COLLAPSED_TOOL_RESULT_LINES) {
    return new Text(
      `${text}\n${theme.fg("muted", "(")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg(
        "muted",
        " to collapse)",
      )}`,
      0,
      0,
    );
  }

  return new Text(text, 0, 0);
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
