import { resolveProjectIdentity } from "../banks/banking.js";
import { resolveOperationBank } from "../banks/bank-selection.js";
import { buildStatusFields } from "../utils/status-fields.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { isMemorySetupComplete, setupRequiredMessage } from "../config/setup-gate.js";
import type { HindsightLikeClient } from "../types.js";

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
  };
}
