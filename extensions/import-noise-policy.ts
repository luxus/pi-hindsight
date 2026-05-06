import type { ResolvedConfig } from "./types.js";

export type ImportNoiseDropReason =
  | "successful-tool-output"
  | "tool-filter-excluded"
  | "tool-result-empty"
  | "recalled-memory"
  | "empty-projection";

export interface ImportToolNoisePolicy {
  dropSuccessful: boolean;
  summaryMaxChars: number;
}

export function resolveImportToolNoisePolicy(config: ResolvedConfig): ImportToolNoisePolicy {
  return {
    dropSuccessful: config.import.toolResults === "errors-only",
    summaryMaxChars: config.import.toolResultSummaryMaxChars,
  };
}

export function importToolAllowed(
  name: string,
  filter: { include?: string[]; exclude?: string[] },
): boolean {
  if (filter.include && !filter.include.includes(name)) return false;
  return !filter.exclude?.includes(name);
}

export function summarizeToolResultContent(content: unknown, maxChars: number): string {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
