import { resolveProjectIdentity } from "../banks/banking.js";
import { resolveBankExistence } from "../banks/bank-operations.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import { buildStatusFields } from "../utils/status-fields.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { isMemorySetupComplete, setupRequiredMessage } from "../config/setup-gate.js";
import { configureMemory, type ProjectConfigPatchInput } from "../config/config-writer.js";
import { seedKnowledgePages } from "../banks/knowledge-page-seed.js";
import type { HindsightLikeClient, ResolvedConfig, TagsMatch } from "../types.js";

/** Keys agents may read/patch via hindsight_config (no raw secrets). */
export const AGENT_CONFIG_ALLOWLIST = [
  "setupComplete",
  "scopeMode",
  "projectId",
  "projectIdStrategy",
  "includeSharedObservations",
  "projectBankId",
  "enableGlobalBank",
  "globalBankId",
  "agentUse",
  "mentalModelsInject",
  "memoryProfile",
  "recallEnabled",
  "recallBudget",
  "recallMaxTokens",
  "retainEnabled",
  "baseUrl",
  "apiKeyEnvVar",
  "timeoutMs",
] as const;

export type AgentConfigKey = (typeof AGENT_CONFIG_ALLOWLIST)[number];

const ALLOWLIST_SET = new Set<string>(AGENT_CONFIG_ALLOWLIST);

export function agentConfigView(config: ResolvedConfig): Record<AgentConfigKey, unknown> {
  let memoryProfile: string = "project-only";
  if (config.recall.enabled && !config.retain.enabled) memoryProfile = "recall-only";
  else if (!config.banks.project.enabled && config.banks.user.enabled)
    memoryProfile = "global-only";
  else if (config.banks.project.enabled && config.banks.user.enabled)
    memoryProfile = "project+global";

  return {
    setupComplete: config.setupComplete,
    scopeMode: config.scope.mode,
    projectId: config.scope.projectId,
    projectIdStrategy: config.scope.projectIdStrategy,
    includeSharedObservations: config.scope.includeSharedObservations,
    projectBankId: config.banks.project.bankId,
    enableGlobalBank: config.banks.user.enabled,
    globalBankId: config.banks.user.bankId,
    agentUse: config.agentUse,
    mentalModelsInject: config.mentalModels.inject,
    memoryProfile,
    recallEnabled: config.recall.enabled,
    recallBudget: config.recall.budget,
    recallMaxTokens: config.recall.maxTokens,
    retainEnabled: config.retain.enabled,
    baseUrl: config.hindsight.baseUrl,
    apiKeyEnvVar: config.hindsight.apiKeyRef?.startsWith("env:")
      ? config.hindsight.apiKeyRef.slice(4)
      : undefined,
    timeoutMs: config.hindsight.timeoutMs,
  };
}

const ENUM_STRINGS: Partial<Record<AgentConfigKey, readonly string[]>> = {
  scopeMode: ["domain-tagged", "isolated-bank"],
  projectIdStrategy: ["remote", "basename"],
  agentUse: ["coding", "conversation"],
  memoryProfile: ["project-only", "project+global", "global-only", "recall-only"],
  recallBudget: ["low", "mid", "high"],
};

const BOOLEAN_KEYS = new Set<AgentConfigKey>([
  "setupComplete",
  "includeSharedObservations",
  "enableGlobalBank",
  "mentalModelsInject",
  "recallEnabled",
  "retainEnabled",
]);

const NUMBER_KEYS = new Set<AgentConfigKey>(["recallMaxTokens", "timeoutMs"]);

function assertAgentConfigValue(key: AgentConfigKey, value: unknown): unknown {
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== "boolean") {
      throw new Error(`Config field ${key} must be a boolean`);
    }
    return value;
  }
  if (NUMBER_KEYS.has(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Config field ${key} must be a non-negative number`);
    }
    return value;
  }
  const allowed = ENUM_STRINGS[key];
  if (allowed) {
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new Error(`Config field ${key} must be one of: ${allowed.join(", ")}`);
    }
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Config field ${key} must be a non-empty string`);
  }
  return value;
}

/** Keep only allowlisted keys from a tool patch object. Rejects unknown keys and bad types. */
export function pickAgentConfigPatch(raw: Record<string, unknown>): ProjectConfigPatchInput {
  const unknown = Object.keys(raw).filter((k) => !ALLOWLIST_SET.has(k));
  if (unknown.length) {
    throw new Error(
      `Config keys not allowlisted for agent patch: ${unknown.join(", ")}. Allowed: ${AGENT_CONFIG_ALLOWLIST.join(", ")}`,
    );
  }
  const out: ProjectConfigPatchInput = {};
  for (const key of AGENT_CONFIG_ALLOWLIST) {
    if (raw[key] === undefined) continue;
    const value = assertAgentConfigValue(key, raw[key]);
    (out as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("Provide at least one allowlisted config field to patch.");
  }
  return out;
}

/** Domain-tagged coding bank must not mark setup complete without an explicit bankId. */
export function assertAgentConfigPatchSafe(
  patch: ProjectConfigPatchInput,
  current: ResolvedConfig,
): void {
  const mode = patch.scopeMode ?? current.scope.mode;
  const projectEnabled =
    patch.memoryProfile === "global-only" || patch.memoryProfile === "recall-only"
      ? false
      : patch.memoryProfile
        ? true
        : current.banks.project.enabled;
  const bankId =
    typeof patch.projectBankId === "string" && patch.projectBankId.trim()
      ? patch.projectBankId.trim()
      : current.banks.project.bankId?.trim();
  const wantsSetupComplete = patch.setupComplete === true;
  if (wantsSetupComplete && mode === "domain-tagged" && projectEnabled && !bankId) {
    throw new Error(
      "Cannot set setupComplete=true in domain-tagged mode without projectBankId. Set projectBankId to the shared coding bank first.",
    );
  }
}

function clientMethod<K extends keyof HindsightLikeClient>(
  deps: MemoryOperationsDeps,
  method: K,
): NonNullable<HindsightLikeClient[K]> {
  const client = deps.getClient();
  const fn = client[method];
  if (typeof fn !== "function") {
    throw new Error(`Hindsight client does not support ${String(method)}.`);
  }
  // Bind without typing bind's overload union (optional methods vary).
  return (fn as (...args: never[]) => unknown).bind(client) as NonNullable<HindsightLikeClient[K]>;
}

/** Agent-facing list fields only (no content / reflect_response / source facts). */
export type MentalModelListItemMetadata = {
  id: string;
  name: string;
  tags?: string[];
  max_tokens?: number;
  last_refreshed_at?: string;
};

function mentalModelListRows(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object"),
    );
  }
  if (!response || typeof response !== "object") return [];
  const body = response as { items?: unknown; mental_models?: unknown };
  const rows = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.mental_models)
      ? body.mental_models
      : [];
  return rows.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object"),
  );
}

/**
 * Project a listMentalModels response to metadata-only items for agent tools.
 * Drops content, reflect_response, and other heavy fields even if the server returns them.
 */
export function projectMentalModelListMetadata(response: unknown): {
  items: MentalModelListItemMetadata[];
} {
  const items: MentalModelListItemMetadata[] = [];
  for (const row of mentalModelListRows(response)) {
    const id = typeof row.id === "string" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    if (!id || !name) continue;
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined;
    const maxTokens =
      typeof row.max_tokens === "number"
        ? row.max_tokens
        : typeof row.maxTokens === "number"
          ? row.maxTokens
          : undefined;
    const lastRefreshedAt =
      typeof row.last_refreshed_at === "string"
        ? row.last_refreshed_at
        : typeof row.lastRefreshedAt === "string"
          ? row.lastRefreshedAt
          : undefined;
    const item: MentalModelListItemMetadata = { id, name };
    if (tags !== undefined) item.tags = tags;
    if (maxTokens !== undefined) item.max_tokens = maxTokens;
    if (lastRefreshedAt !== undefined) item.last_refreshed_at = lastRefreshedAt;
    items.push(item);
  }
  return { items };
}

export function createControlOperations(deps: MemoryOperationsDeps) {
  return {
    async status(cwd: string) {
      const config = deps.getConfig();
      const fields = buildStatusFields(config, {
        cwd,
        projectBankId: deps.getProjectBankId(),
      });
      const { buildSyncStatus } = await import("../lifecycle/git-seed.js");
      const sync = await buildSyncStatus({
        cwd,
        config,
        client: deps.getClient(),
        bankId: deps.getProjectBankId(),
      });
      return {
        setupComplete: isMemorySetupComplete(config, cwd),
        ...(isMemorySetupComplete(config, cwd) ? {} : { setupHint: setupRequiredMessage() }),
        project: resolveProjectIdentity(cwd, config),
        fields,
        sync,
      };
    },

    scopeInfo(cwd: string) {
      const config = deps.getConfig();
      const project = resolveProjectIdentity(cwd, config);
      return {
        scopeMode: config.scope.mode,
        projectId: project.projectId,
        basis: project.basis,
        source: project.source,
        projectTag: `project:${project.projectId}`,
        legacyRepoTag: `repo:${project.legacyRepoKey}`,
        codingBankId: deps.getProjectBankId(),
        lifeBankId: config.banks.user.enabled ? config.banks.user.bankId : undefined,
        dualTagWindow: true,
      };
    },

    async bankGet(args: { bank?: string }) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const client = deps.getClient();
      // Existence via list-banks (profile fallback). Isolate so a retired /profile 410
      // cannot fail stats/config. Do not treat GET /config as existence (Hindsight #4127).
      const [exists, stats, bankConfig] = await Promise.all([
        resolveBankExistence(client, bankId),
        client.getBankStats?.(bankId),
        client.getBankConfig?.(bankId),
      ]);
      return { bankId, exists: exists ?? null, stats, config: bankConfig };
    },

    async bankUpdateMission(args: {
      bank?: string;
      retainMission?: string;
      reflectMission?: string;
      observationsMission?: string;
      dryRun?: boolean;
    }) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const patch = {
        ...(args.retainMission !== undefined ? { retainMission: args.retainMission } : {}),
        ...(args.reflectMission !== undefined ? { reflectMission: args.reflectMission } : {}),
        ...(args.observationsMission !== undefined
          ? { observationsMission: args.observationsMission }
          : {}),
      };
      if (Object.keys(patch).length === 0) {
        throw new Error(
          "Provide at least one of retainMission, reflectMission, observationsMission.",
        );
      }
      // Mutating ops default dry-run at the operation layer (not only the tool catalog).
      if (args.dryRun ?? true) {
        return { dryRun: true, bankId, wouldUpdate: patch };
      }
      const update = clientMethod(deps, "updateBankConfig");
      const result = await update(bankId, patch);
      return { bankId, updated: patch, result };
    },

    async mentalModel(args: {
      action: "list" | "get" | "create" | "update" | "refresh" | "delete";
      bank?: string;
      id?: string;
      name?: string;
      sourceQuery?: string;
      tags?: string[];
      maxTokens?: number;
      /** How model tags filter source memories on refresh (create/update trigger). */
      tagsMatch?: TagsMatch;
      dryRun?: boolean;
      cwd: string;
    }) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const project = resolveProjectIdentity(args.cwd, config);
      const isUserBank =
        args.bank === "global" ||
        args.bank === "user" ||
        (config.banks.user.bankId !== undefined && args.bank === config.banks.user.bankId);

      switch (args.action) {
        case "list": {
          const list = clientMethod(deps, "listMentalModels");
          // Prefer server metadata detail; always project so agent context cannot carry content.
          const raw = await list(bankId, { detail: "metadata" });
          return { bankId, result: projectMentalModelListMetadata(raw) };
        }
        case "get": {
          if (!args.id) throw new Error("id is required for get");
          const get = clientMethod(deps, "getMentalModel");
          return { bankId, result: await get(bankId, args.id) };
        }
        case "create": {
          if (!args.name?.trim() || !args.sourceQuery?.trim()) {
            throw new Error("name and sourceQuery are required for create");
          }
          const tags =
            args.tags ??
            (isUserBank ? ["source:pi"] : ["source:pi", `project:${project.projectId}`]);
          const trigger = {
            refreshAfterConsolidation: true as const,
            ...(args.tagsMatch ? { tagsMatch: args.tagsMatch } : {}),
          };
          if (args.dryRun ?? true) {
            return {
              dryRun: true,
              bankId,
              wouldCreate: {
                name: args.name,
                sourceQuery: args.sourceQuery,
                tags,
                trigger,
              },
            };
          }
          const create = clientMethod(deps, "createMentalModel");
          const result = await create(bankId, args.name.trim(), args.sourceQuery.trim(), {
            ...(args.id ? { id: args.id } : {}),
            tags,
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
            trigger,
          });
          return { bankId, result };
        }
        case "update": {
          if (!args.id) throw new Error("id is required for update");
          const options = {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.sourceQuery !== undefined ? { sourceQuery: args.sourceQuery } : {}),
            ...(args.tags !== undefined ? { tags: args.tags } : {}),
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
            ...(args.tagsMatch
              ? { trigger: { refreshAfterConsolidation: true, tagsMatch: args.tagsMatch } }
              : {}),
          };
          if (Object.keys(options).length === 0) {
            throw new Error(
              "Provide name, sourceQuery, tags, maxTokens, and/or tagsMatch for update",
            );
          }
          if (args.dryRun ?? true)
            return { dryRun: true, bankId, id: args.id, wouldUpdate: options };
          const update = clientMethod(deps, "updateMentalModel");
          return { bankId, result: await update(bankId, args.id, options) };
        }
        case "refresh": {
          if (!args.id) throw new Error("id is required for refresh");
          if (args.dryRun ?? true) return { dryRun: true, bankId, id: args.id, wouldRefresh: true };
          const refresh = clientMethod(deps, "refreshMentalModel");
          return { bankId, result: await refresh(bankId, args.id) };
        }
        case "delete": {
          if (!args.id) throw new Error("id is required for delete");
          const del = clientMethod(deps, "deleteMentalModel");
          return {
            bankId,
            result: await del(bankId, args.id, { dryRun: args.dryRun ?? true }),
          };
        }
        default:
          throw new Error(`Unknown mental model action: ${String(args.action)}`);
      }
    },

    /**
     * Knowledge pages control plane (tree/search/get + dry-run mutating folder/page ops).
     * Requires a Hindsight client/server that exposes knowledge-base methods.
     */
    async knowledge(args: {
      action:
        | "tree"
        | "search"
        | "get"
        | "export"
        | "seed_taxonomy"
        | "create_page"
        | "create_folder"
        | "update"
        | "delete";
      bank?: string;
      id?: string;
      query?: string;
      limit?: number;
      name?: string;
      sourceQuery?: string;
      parentId?: string | null;
      tags?: string[];
      maxTokens?: number;
      /** Page create only — when set, restates server page defaults + tagsMatch (trigger replace). */
      tagsMatch?: TagsMatch;
      dryRun?: boolean;
      cwd: string;
    }) {
      const config = deps.getConfig();
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config,
        projectBankId: deps.getProjectBankId(),
      });
      const project = resolveProjectIdentity(args.cwd, config);
      const isUserBank =
        args.bank === "global" ||
        args.bank === "user" ||
        (config.banks.user.bankId !== undefined && args.bank === config.banks.user.bankId);

      switch (args.action) {
        case "tree": {
          const tree = clientMethod(deps, "getKnowledgeBaseTree");
          return { bankId, result: await tree(bankId) };
        }
        case "seed_taxonomy": {
          // Idempotent five-page coding taxonomy; degrades when pages are unavailable.
          const baseTags = isUserBank
            ? ["source:pi"]
            : ["source:pi", `project:${project.projectId}`];
          const seed = await seedKnowledgePages({
            client: deps.getClient(),
            bankId,
            baseTags,
            dryRun: args.dryRun ?? true,
          });
          return { bankId, seed };
        }
        case "search": {
          if (!args.query?.trim()) throw new Error("query is required for search");
          const search = clientMethod(deps, "searchKnowledgeBase");
          return {
            bankId,
            result: await search(
              bankId,
              args.query.trim(),
              args.limit !== undefined ? { limit: args.limit } : undefined,
            ),
          };
        }
        case "get": {
          if (!args.id) throw new Error("id is required for get");
          const get = clientMethod(deps, "getKnowledgePage");
          return { bankId, result: await get(bankId, args.id) };
        }
        case "export": {
          // Portable markdown bundle of the whole knowledge base (not for routine Q&A).
          const exp = clientMethod(deps, "exportKnowledgeBase");
          return { bankId, result: await exp(bankId) };
        }
        case "create_page": {
          if (!args.name?.trim() || !args.sourceQuery?.trim()) {
            throw new Error("name and sourceQuery are required for create_page");
          }
          const tags =
            args.tags ??
            (isUserBank ? ["source:pi"] : ["source:pi", `project:${project.projectId}`]);
          // Omit trigger to keep server page defaults; only restate them when tagsMatch is set
          // (a supplied trigger replaces defaults rather than merging).
          const trigger = args.tagsMatch
            ? {
                mode: "delta" as const,
                factTypes: ["observation" as const],
                excludeMentalModels: true,
                refreshAfterConsolidation: true,
                tagsMatch: args.tagsMatch,
              }
            : undefined;
          const wouldCreate = {
            name: args.name.trim(),
            sourceQuery: args.sourceQuery.trim(),
            tags,
            ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
            ...(trigger ? { trigger } : {}),
          };
          if (args.dryRun ?? true) return { dryRun: true, bankId, wouldCreate };
          const create = clientMethod(deps, "createKnowledgePage");
          const result = await create(bankId, wouldCreate.name, wouldCreate.sourceQuery, {
            tags,
            ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
            ...(trigger ? { trigger } : {}),
          });
          return { bankId, result };
        }
        case "create_folder": {
          if (!args.name?.trim()) throw new Error("name is required for create_folder");
          const wouldCreate = {
            name: args.name.trim(),
            ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
          };
          if (args.dryRun ?? true) return { dryRun: true, bankId, wouldCreate };
          const create = clientMethod(deps, "createKnowledgeFolder");
          const result = await create(
            bankId,
            wouldCreate.name,
            args.parentId !== undefined ? { parentId: args.parentId } : undefined,
          );
          return { bankId, result };
        }
        case "update": {
          if (!args.id) throw new Error("id is required for update");
          const options: {
            name?: string;
            parentId?: string | null;
            sourceQuery?: string;
            tags?: string[];
            maxTokens?: number;
          } = {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...("parentId" in args ? { parentId: args.parentId } : {}),
            ...(args.sourceQuery !== undefined ? { sourceQuery: args.sourceQuery } : {}),
            ...(args.tags !== undefined ? { tags: args.tags } : {}),
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
          };
          if (Object.keys(options).length === 0) {
            throw new Error(
              "Provide name, parentId, sourceQuery, tags, and/or maxTokens for update",
            );
          }
          if (args.dryRun ?? true)
            return { dryRun: true, bankId, id: args.id, wouldUpdate: options };
          const update = clientMethod(deps, "updateKnowledgeNode");
          return { bankId, result: await update(bankId, args.id, options) };
        }
        case "delete": {
          if (!args.id) throw new Error("id is required for delete");
          if (args.dryRun ?? true) return { dryRun: true, bankId, id: args.id, wouldDelete: true };
          const del = clientMethod(deps, "deleteKnowledgeNode");
          return { bankId, result: await del(bankId, args.id) };
        }
        default:
          throw new Error(`Unknown knowledge action: ${String(args.action)}`);
      }
    },

    /**
     * Agent allowlisted config get/patch. Writes project (or optional global) config files.
     * Never accepts direct API keys — use apiKeyEnvVar only.
     */
    async config(args: {
      action: "get" | "patch";
      cwd: string;
      patch?: Record<string, unknown>;
      scope?: "project" | "global";
      dryRun?: boolean;
    }) {
      const config = deps.getConfig();
      if (args.action === "get") {
        return {
          allowlist: [...AGENT_CONFIG_ALLOWLIST],
          scope: args.scope ?? "project",
          values: agentConfigView(config),
          note: "Secrets are never returned. Patch only allowlisted keys; dryRun defaults true for patch.",
        };
      }
      if (!args.patch || typeof args.patch !== "object") {
        throw new Error("patch object is required for action=patch");
      }
      const picked = pickAgentConfigPatch(args.patch);
      assertAgentConfigPatchSafe(picked, config);
      const input: ProjectConfigPatchInput = {
        ...picked,
        scope: args.scope ?? "project",
      };
      if (args.dryRun ?? true) {
        return {
          dryRun: true,
          scope: input.scope,
          wouldPatch: picked,
          allowlist: [...AGENT_CONFIG_ALLOWLIST],
        };
      }
      const result = await configureMemory(args.cwd, input, deps);
      return {
        dryRun: false,
        scope: input.scope,
        patched: picked,
        path: result.path,
        projectBankId: result.projectBankId,
        values: agentConfigView(deps.getConfig()),
      };
    },
  };
}
