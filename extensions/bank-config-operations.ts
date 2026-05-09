import { resolveOperationBank } from "./bank-selection.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";

function unavailable(name: string): Error {
  return new Error(`Hindsight client does not support bank config ${name}.`);
}

export function createBankConfigOperations(deps: MemoryOperationsDeps) {
  return {
    async getBankConfig(args: { bank?: string } = {}) {
      const client = deps.getClient();
      if (!client.getBankConfig) throw unavailable("read");
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const result = await client.getBankConfig(bankId);
      return { bankId, result };
    },

    async updateBankConfig(args: {
      bank?: string;
      updates: Record<string, unknown>;
      confirm?: boolean;
    }) {
      if (args.confirm !== true) throw new Error("confirm:true is required to update bank config");
      const client = deps.getClient();
      if (!client.updateBankConfig) throw unavailable("update");
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const before = client.getBankConfig ? await client.getBankConfig(bankId) : undefined;
      const result = await client.updateBankConfig(bankId, args.updates);
      const after = client.getBankConfig ? await client.getBankConfig(bankId) : undefined;
      return { bankId, updates: args.updates, before, result, after };
    },

    async resetBankConfig(args: { bank?: string; confirm?: boolean } = {}) {
      if (args.confirm !== true) throw new Error("confirm:true is required to reset bank config");
      const client = deps.getClient();
      if (!client.resetBankConfig) throw unavailable("reset");
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const before = client.getBankConfig ? await client.getBankConfig(bankId) : undefined;
      const result = await client.resetBankConfig(bankId);
      const after = client.getBankConfig ? await client.getBankConfig(bankId) : undefined;
      return { bankId, before, result, after };
    },
  };
}
