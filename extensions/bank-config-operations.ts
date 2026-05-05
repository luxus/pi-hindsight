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

    async resetBankConfig(args: { bank?: string } = {}) {
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
