import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { ConfigEditingTab } from "../config/config-editing-model.js";
import type { RetainReceipt } from "../lifecycle/retain-receipts.js";
import { formatRetainOutcome } from "../queue/flush-presenter.js";
import {
  applySetupIntent,
  currentSetupTab,
  normalizeSetupUiState,
  selectedSetupField,
  selectedSetupIndex,
  setupIntentFromInput,
} from "./setup-flow.js";
import {
  HUB_ACTION_HELP,
  RECEIPT_FACT_LIMIT,
  type SetupActionId,
  type SetupUiState,
  type ThemeLike,
} from "./setup-tui-types.js";

const MIN_BODY_LINES = 30;
const DOCS_BASE_URL = "https://luxus.github.io/pi-hindsight";

const TAB_DOCS: Record<string, string> = {
  Status: `${DOCS_BASE_URL}/guides/use-hindsight-status/`,
  Connection: `${DOCS_BASE_URL}/start/installation/`,
  Banks: `${DOCS_BASE_URL}/concepts/memory-banks/`,
  Recall: `${DOCS_BASE_URL}/concepts/retain-recall-reflect/`,
  Retain: `${DOCS_BASE_URL}/concepts/queue-durability/`,
  Import: `${DOCS_BASE_URL}/guides/importing-sessions/`,
  UI: `${DOCS_BASE_URL}/start/setup-tui/`,
};

function fitColumns(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (width < 40) return truncateToWidth(`${left} ${right}`, width);
  const rightWidth = Math.min(Math.max(12, visibleWidth(right)), Math.floor(width * 0.38));
  const leftWidth = Math.max(1, width - rightWidth - 1);
  return `${truncateToWidth(left, leftWidth)} ${truncateToWidth(right, rightWidth)}`;
}

function borderLine(
  width: number,
  left: string,
  fill: string,
  right: string,
  theme: ThemeLike,
): string {
  return theme.fg("borderAccent", `${left}${fill.repeat(Math.max(0, width - 2))}${right}`);
}

function padVisibleRight(content: string, width: number): string {
  const truncated = truncateToWidth(content, width);
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function boxed(content: string, width: number, theme: ThemeLike): string {
  if (width < 2) return truncateToWidth(content, width);
  return `${theme.fg("borderAccent", "│")}${padVisibleRight(content, width - 2)}${theme.fg("borderAccent", "│")}`;
}

function shortDocumentId(documentId: string): string {
  const parts = documentId.split(":");
  if (parts[0] === "pi-explicit" && parts.length >= 3) return `${parts[0]}:${parts[2]}`;
  return documentId;
}

function wrapWords(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function buildRetainReceiptStatusFacts(receipts: RetainReceipt[]): Array<[string, string]> {
  if (receipts.length === 0) return [["Retain receipts", "none"]];
  return receipts.slice(0, RECEIPT_FACT_LIMIT).map((receipt, index) => {
    const outcome = formatRetainOutcome(receipt.outcome);
    const value = `${receipt.bankId} ${shortDocumentId(receipt.documentId)}${
      outcome ? ` (${outcome})` : ""
    }`;
    return [index === 0 ? "Recent retain" : `Recent retain ${index + 1}`, value];
  });
}

export function createSetupComponent(
  tabs: ConfigEditingTab[],
  theme: ThemeLike,
  state: SetupUiState,
  done: (action: SetupActionId | null) => void,
): Component {
  Object.assign(state, normalizeSetupUiState(tabs, state));

  return {
    render(width: number): string[] {
      Object.assign(state, normalizeSetupUiState(tabs, state));
      const tab = currentSetupTab(tabs, state) ?? tabs[0]!;
      const lines: string[] = [];
      const innerWidth = Math.max(0, width - 2);
      const changedCount = tabs.reduce(
        (count, item) => count + item.fields.filter((field) => field.changed).length,
        0,
      );
      const horizontal = new DynamicBorder((s: string) => theme.fg("borderAccent", s));

      lines.push(...horizontal.render(width));
      lines.push(borderLine(width, "╭", "─", "╮", theme));
      lines.push(
        boxed(
          ` ${theme.fg("accent", theme.bold("Hindsight setup"))} ${theme.fg("dim", "saved immediately after edit · changed values marked *")}`,
          width,
          theme,
        ),
      );
      lines.push(
        boxed(` ${theme.fg("dim", `${changedCount} changed from defaults`)}`, width, theme),
      );
      lines.push(boxed("", width, theme));

      const tabLine = tabs
        .map((item, index) => {
          const dirty = item.fields.some((field) => field.changed) ? "*" : "";
          const label = ` ${item.id}${dirty} `;
          return index === state.tabIndex
            ? theme.bg("selectedBg", theme.fg("accent", theme.bold(label)))
            : theme.fg("muted", label);
        })
        .join(" ");
      lines.push(boxed(tabLine, width, theme));
      lines.push(boxed("", width, theme));

      lines.push(
        boxed(
          theme.fg(
            "accent",
            theme.bold(tab.id === "Status" ? "Memory status" : `${tab.id} settings`),
          ),
          width,
          theme,
        ),
      );
      if (tab.facts) {
        for (const [label, value] of tab.facts) {
          lines.push(
            boxed(
              fitColumns(
                `   ${theme.fg("muted", `${label}:`)}`,
                theme.fg("text", value),
                innerWidth,
              ),
              width,
              theme,
            ),
          );
        }
      } else {
        lines.push(
          boxed(theme.fg("dim", fitColumns("Setting", "Value", innerWidth)), width, theme),
        );
      }

      for (const [index, field] of tab.fields.entries()) {
        const isSelected = index === selectedSetupIndex(tabs, state);
        const marker = isSelected ? theme.fg("accent", "→") : " ";
        const dirty = field.changed ? theme.fg("warning", "*") : " ";
        const label = isSelected
          ? theme.fg("accent", theme.bold(field.label))
          : theme.fg("text", field.label);
        const rawValue = `${field.value} [${field.source ?? "default"}]`;
        const value = field.changed ? theme.fg("warning", rawValue) : theme.fg("text", rawValue);
        lines.push(
          boxed(fitColumns(`${marker}${dirty} ${label}`, value, innerWidth), width, theme),
        );
      }

      const detailField = selectedSetupField(tabs, state);
      if (detailField) {
        lines.push(boxed("", width, theme));
        lines.push(boxed(theme.fg("accent", theme.bold("Details")), width, theme));
        const details = [
          `Docs: ${TAB_DOCS[detailField.tab] ?? `${DOCS_BASE_URL}/reference/configuration/`}`,
          detailField.description,
          `Default: ${detailField.defaultValue}`,
          ...(detailField.projectValue ? [`Project: ${detailField.projectValue}`] : []),
          ...(detailField.globalValue ? [`User: ${detailField.globalValue}`] : []),
          ...(detailField.envValue ? [`Env: ${detailField.envValue}`] : []),
        ];
        for (const detail of details) {
          for (const line of wrapWords(detail, innerWidth - 3)) {
            lines.push(boxed(`   ${theme.fg("dim", line)}`, width, theme));
          }
        }
      } else if (tab.id === "Status") {
        lines.push(boxed("", width, theme));
        lines.push(boxed(theme.fg("accent", theme.bold("Docs")), width, theme));
        for (const line of wrapWords(`Status guide: ${TAB_DOCS.Status}`, innerWidth - 3)) {
          lines.push(boxed(`   ${theme.fg("dim", line)}`, width, theme));
        }
      }

      while (lines.length < MIN_BODY_LINES) lines.push(boxed("", width, theme));

      lines.push(
        boxed(
          theme.fg(
            "dim",
            state.showAdvanced
              ? ` advanced · h/l tabs · j/k · enter edit · r reset ·${HUB_ACTION_HELP}`
              : ` hub ·${HUB_ACTION_HELP}`,
          ),
          width,
          theme,
        ),
      );
      lines.push(borderLine(width, "╰", "─", "╯", theme));
      lines.push(...horizontal.render(width));
      return lines.map((line) => truncateToWidth(line, width));
    },
    handleInput(data: string): void {
      const intent = setupIntentFromInput(data);
      if (!intent) return;
      const result = applySetupIntent(tabs, state, intent);
      Object.assign(state, result.state);
      if (result.kind === "action") done(result.action);
    },
    invalidate(): void {},
  };
}
