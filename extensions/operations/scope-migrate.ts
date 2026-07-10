import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  deriveProjectBankId,
  legacyRepoScopeTag,
  projectScopeTag,
  resolveProjectIdentity,
} from "../banks/banking.js";
import type { ResolvedConfig } from "../types.js";

export interface ScopeMigratePlan {
  dryRun: true;
  /** Never rewrites banks/tags from this plan alone. */
  rewrite: "none";
  bankId: string;
  pathDerivedBank: boolean;
  scopeMode: ResolvedConfig["scope"]["mode"];
  projectTag: string;
  legacyRepoTag: string;
  projectId: string;
  projectIdBasis: "pin" | "remote" | "basename";
  projectIdSource: string;
  dualTagWindow: true;
  /** True when current path-hash legacy tag would not match another machine's path for same basename. */
  pathHashFragile: boolean;
  findings: string[];
  guidance: string[];
  /** Optional remote tag sample counts when listTags results were provided. */
  remoteTagCounts?: {
    projectTagHits: number;
    legacyRepoTagHits: number;
    otherRepoTags: string[];
    sampleSize: number;
  };
  createdAt: string;
}

export interface ScopeMigrateReceipt extends ScopeMigratePlan {
  receiptPath: string;
}

function basenameFragility(legacyRepoKey: string, projectId: string): boolean {
  // legacy key is typically `<slug>-<12hex>`; path moves change the hash.
  const dash = legacyRepoKey.lastIndexOf("-");
  if (dash <= 0) return true;
  const slug = legacyRepoKey.slice(0, dash);
  const hash = legacyRepoKey.slice(dash + 1);
  if (!/^[a-f0-9]{8,}$/i.test(hash)) return true;
  // Fragile when identity is path-sensitive (basename) or slug only loosely matches project id.
  return projectId === slug || !projectId.includes("/");
}

/**
 * Build a dry-run scope migration plan. Never mutates Hindsight banks or tags.
 * Dual-tag retain/recall already covers the live window; this plan documents risk and next steps.
 */
export function buildScopeMigratePlan(args: {
  cwd: string;
  config: ResolvedConfig;
  projectBankId?: string;
  bankTags?: string[];
  now?: Date;
}): ScopeMigratePlan {
  const identity = resolveProjectIdentity(args.cwd, args.config);
  const bankId = args.projectBankId ?? deriveProjectBankId(args.cwd, args.config);
  const pathDerivedBank = !args.config.banks.project.bankId;
  const projectTag = projectScopeTag(identity.projectId);
  const legacyRepoTag = legacyRepoScopeTag(identity.legacyRepoKey);
  const pathHashFragile = basenameFragility(identity.legacyRepoKey, identity.projectId);

  const findings: string[] = [];
  const guidance: string[] = [];

  findings.push(
    `Active dual-tag window: retain writes ${projectTag} and ${legacyRepoTag}; recall any_strict matches either.`,
  );
  findings.push(`Project id basis=${identity.basis} source=${identity.source} → ${projectTag}.`);

  if (pathDerivedBank) {
    findings.push(
      `Coding bank is path-derived (${bankId}); domain-tagged mode should set banks.project.bankId to a shared coding bank.`,
    );
    guidance.push(
      "Set banks.project.bankId (and setupComplete) so repos share one coding bank; do not rely on path-hash bank ids.",
    );
  }

  if (identity.basis === "basename") {
    findings.push(
      "Project id is basename-derived; remotes or pins are more stable across clones and renames.",
    );
    guidance.push(
      'Prefer scope.projectId pin or projectIdStrategy "remote" when a git origin exists.',
    );
  }

  if (pathHashFragile) {
    findings.push(
      "Legacy repo:<slug>-<path-hash> tags break when the absolute path changes (e.g. Mac↔Linux). Dual-tag project: recovers new writes; older repo-only memories may miss.",
    );
    guidance.push(
      "Keep dual-tag until reimport/rebuild. Prefer Hindsight document export/import when available; otherwise reimport Pi transcripts with replace into the coding bank.",
    );
  }

  let remoteTagCounts: ScopeMigratePlan["remoteTagCounts"];
  if (args.bankTags?.length) {
    const otherRepoTags = [
      ...new Set(args.bankTags.filter((t) => t.startsWith("repo:") && t !== legacyRepoTag)),
    ].sort();
    const projectTagHits = args.bankTags.filter((t) => t === projectTag).length;
    const legacyRepoTagHits = args.bankTags.filter((t) => t === legacyRepoTag).length;
    remoteTagCounts = {
      projectTagHits,
      legacyRepoTagHits,
      otherRepoTags,
      sampleSize: args.bankTags.length,
    };
    findings.push(
      `Remote tag sample (${args.bankTags.length}): project hits=${projectTagHits}, legacy hits=${legacyRepoTagHits}, other repo:* tags=${otherRepoTags.length}.`,
    );
    if (legacyRepoTagHits > 0 && projectTagHits === 0) {
      findings.push(
        "Sample has legacy repo tags without the stable project tag — reimport or dual-tag new retains before dropping dual-tag.",
      );
    }
    if (otherRepoTags.length > 0) {
      findings.push(
        `Other path-hash repo tags present (likely other machines/paths): ${otherRepoTags.slice(0, 5).join(", ")}${otherRepoTags.length > 5 ? "…" : ""}.`,
      );
      guidance.push(
        "Other repo:* path-hashes are expected after path moves; dual-tag project: is the recovery path for new retains.",
      );
    }
  } else {
    guidance.push(
      "Optional: pass bank tag inventory (listTags) into dry-run for remote counts; this local plan never rewrites.",
    );
  }

  guidance.push(
    "No silent rewrite: this dry-run only writes a local receipt under .pi/hindsight/.",
  );
  guidance.push(
    "When dual-tag can end: every active project memory carries project:<id> (or you completed export/import rebuild).",
  );

  return {
    dryRun: true,
    rewrite: "none",
    bankId,
    pathDerivedBank,
    scopeMode: args.config.scope.mode,
    projectTag,
    legacyRepoTag,
    projectId: identity.projectId,
    projectIdBasis: identity.basis,
    projectIdSource: identity.source,
    dualTagWindow: true,
    pathHashFragile,
    findings,
    guidance,
    ...(remoteTagCounts ? { remoteTagCounts } : {}),
    createdAt: (args.now ?? new Date()).toISOString(),
  };
}

export function resolveScopeMigrateReceiptPath(cwd: string): string {
  return join(cwd, ".pi", "hindsight", "scope-migrate-receipt.json");
}

export async function writeScopeMigrateReceipt(
  cwd: string,
  plan: ScopeMigratePlan,
): Promise<ScopeMigrateReceipt> {
  const receiptPath = resolveScopeMigrateReceiptPath(cwd);
  await mkdir(dirname(receiptPath), { recursive: true });
  const receipt: ScopeMigrateReceipt = { ...plan, receiptPath };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}
