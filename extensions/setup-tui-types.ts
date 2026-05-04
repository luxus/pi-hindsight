import type { FieldId, TabId } from "./config-editing-model.js";

export type SetupActionId =
  | FieldId
  | `reset:${FieldId}`
  | "choose-deployment"
  | "guided-setup"
  | "flush-queue"
  | "mental-models"
  | "toggle-advanced"
  | "done";

export type SetupStep = "config" | "profile" | "banks" | "template" | "review" | "done";

export type SetupProfileChoice = "project-only" | "project-global" | "global-only";

export type SetupTemplateChoice =
  | "none"
  | "coding-project"
  | "assistant-personal"
  | "general-user"
  | "paste-json";

export type SetupUiState = {
  step?: SetupStep;
  tabIndex: number;
  selectedByTab: Partial<Record<TabId, number>>;
  showAdvanced?: boolean;
  profileChoice?: SetupProfileChoice;
  templateChoice?: SetupTemplateChoice;
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
