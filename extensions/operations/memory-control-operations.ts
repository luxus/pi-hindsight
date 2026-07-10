import { resolveProjectIdentity } from "../banks/banking.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import { buildStatusFields } from "../utils/status-fields.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { isMemorySetupComplete, setupRequiredMessage } from "../config/setup-gate.js";
import { configureMemory, type ProjectConfigPatchInput } from "../config/config-writer.js";
import type { HindsightLikeClient, ResolvedConfig } from "../types.js";

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

/** Keep only allowlisted keys from a tool patch object. Rejects unknown keys. */
export function pickAgentConfigPatch(
  raw: Record<string, unknown>,
): Partial<Record<AgentConfigKey, unknown>> {
  const unknown = Object.keys(raw).filter((k) => !ALLOWLIST_SET.has(k));
  if (unknown.length) {
    throw new Error(
      `Config keys not allowlisted for agent patch: ${unknown.join(", ")}. Allowed: ${AGENT_CONFIG_ALLOWLIST.join(", ")}`,
    );
  }
  const out: Partial<Record<AgentConfigKey, unknown>> = {};
  for (const key of AGENT_CONFIG_ALLOWLIST) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  if (Object.keys(out).length === 0) {
    throw new Error("Provide at least one allowlisted config field to patch.");
  }
  return out;
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

export function createControlOperations(deps: MemoryOperationsDeps) {
  return {
    status(cwd: string) {
      const config = deps.getConfig();
      const fields = buildStatusFields(config, {
        cwd,
        projectBankId: deps.getProjectBankId(),
      });
      return {
        setupComplete: isMemorySetupComplete(config, cwd),
        ...(isMemorySetupComplete(config, cwd) ? {} : { setupHint: setupRequiredMessage() }),
        project: resolveProjectIdentity(cwd, config),
        fields,
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
      const [profile, stats, bankConfig] = await Promise.all([
        client.getBankProfile?.(bankId),
        client.getBankStats?.(bankId),
        client.getBankConfig?.(bankId),
      ]);
      return { bankId, profile, stats, config: bankConfig };
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
      if (args.dryRun) {
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
          return { bankId, result: await list(bankId) };
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
          if (args.dryRun) {
            return {
              dryRun: true,
              bankId,
              wouldCreate: { name: args.name, sourceQuery: args.sourceQuery, tags },
            };
          }
          const create = clientMethod(deps, "createMentalModel");
          const result = await create(bankId, args.name.trim(), args.sourceQuery.trim(), {
            ...(args.id ? { id: args.id } : {}),
            tags,
            ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
            trigger: { refreshAfterConsolidation: true },
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
          };
          if (Object.keys(options).length === 0) {
            throw new Error("Provide name, sourceQuery, tags, and/or maxTokens for update");
          }
          if (args.dryRun) return { dryRun: true, bankId, id: args.id, wouldUpdate: options };
          const update = clientMethod(deps, "updateMentalModel");
          return { bankId, result: await update(bankId, args.id, options) };
        }
        case "refresh": {
          if (!args.id) throw new Error("id is required for refresh");
          if (args.dryRun) return { dryRun: true, bankId, id: args.id, wouldRefresh: true };
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
      const input: ProjectConfigPatchInput = {
        ...(picked as ProjectConfigPatchInput),
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
