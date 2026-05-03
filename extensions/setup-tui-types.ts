import type { FieldId, TabId } from "./config-editing-model.js";

export type SetupActionId =
  | FieldId
  | `reset:${FieldId}`
  | "choose-deployment"
  | "toggle-advanced"
  | "done";

export type SetupUiState = {
  tabIndex: number;
  selectedByTab: Partial<Record<TabId, number>>;
  showAdvanced?: boolean;
};

export type ThemeLike = {
  fg(
    color: "accent" | "muted" | "dim" | "success" | "error" | "warning" | "borderAccent" | "text",
    text: string,
  ): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
};

export const RECEIPT_FACT_LIMIT = 3;
export const CANCEL = "Cancel";
