import type { RecallResultItem } from "./types.js";

export type RecallQualityDropReason = "blank-memory" | "recall-contamination" | "duplicate-memory";

export interface RecallQualityDecision {
  item: RecallResultItem;
  decision: "keep" | "drop";
  reasons: RecallQualityDropReason[];
}

function itemText(item: RecallResultItem): string {
  return item.text ?? item.content ?? JSON.stringify(item);
}

function normalizedMemoryText(item: RecallResultItem): string {
  return itemText(item).replace(/\s+/g, " ").trim().toLowerCase();
}

function isRecallContamination(text: string): boolean {
  return /<\/?hindsight[-_]memor(?:y|ies)>|customType["']?\s*:\s*["']hindsight-recall|last-recall\.json/.test(
    text,
  );
}

export function classifyRecallQuality(
  item: RecallResultItem,
  seen: Set<string>,
): RecallQualityDecision {
  const text = normalizedMemoryText(item);
  const reasons: RecallQualityDropReason[] = [];
  if (!text) reasons.push("blank-memory");
  if (isRecallContamination(itemText(item))) reasons.push("recall-contamination");
  if (text && seen.has(text)) reasons.push("duplicate-memory");
  if (!reasons.length) seen.add(text);
  return { item, decision: reasons.length ? "drop" : "keep", reasons };
}

export function filterRecallQuality(items: RecallResultItem[]): {
  items: RecallResultItem[];
  decisions: RecallQualityDecision[];
  dropped: number;
  reasonCounts: Partial<Record<RecallQualityDropReason, number>>;
} {
  const seen = new Set<string>();
  const decisions = items.map((item) => classifyRecallQuality(item, seen));
  const reasonCounts: Partial<Record<RecallQualityDropReason, number>> = {};
  for (const decision of decisions) {
    for (const reason of decision.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    items: decisions
      .filter((decision) => decision.decision === "keep")
      .map((decision) => decision.item),
    decisions,
    dropped: decisions.filter((decision) => decision.decision === "drop").length,
    reasonCounts,
  };
}
