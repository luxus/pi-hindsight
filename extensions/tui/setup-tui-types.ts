import type { FieldId, TabId } from "../config/config-editing-model.js";

/** Day-to-day hub actions reachable from the `/hindsight` TUI. */
export type HubActionId =
  | "choose-deployment"
  | "guided-setup"
  | "flush-queue"
  | "set-mode"
  | "next-opt-out"
  | "apply-mental-models"
  | "import-sessions"
  | "run-doctor"
  | "init-config"
  | "toggle-advanced"
  | "done";

export type SetupActionId = FieldId | `reset:${FieldId}` | HubActionId;

export type SetupStep = "config" | "profile" | "banks" | "review" | "done";

export type SetupProfileChoice = "project-user" | "project-only" | "user-only" | "recall-only";

export type SetupUiState = {
  step?: SetupStep;
  tabIndex: number;
  selectedByTab: Partial<Record<TabId, number>>;
  showAdvanced?: boolean;
  profileChoice?: SetupProfileChoice;
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

export const HUB_ACTION_HELP =
  " g guided · m mode · x next-opt-out · t mental models · i import · f flush · o doctor · n init · d deployment · a advanced · q close ";
