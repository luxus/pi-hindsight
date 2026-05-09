import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import { resolveOperationBank } from "./bank-selection.js";

export function createDocumentOperations(deps: MemoryOperationsDeps) {
  return {
    async deleteDocument(args: { bank: string; documentId: string; confirm: true }) {
      if (!args.confirm) throw new Error("Set confirm=true to delete this Hindsight document.");
      const bankId = resolveOperationBank({
        requestedBank: args.bank,
        config: deps.getConfig(),
        projectBankId: deps.getProjectBankId(),
      });
      const client = deps.getClient();
      if (!client.deleteDocument)
        throw new Error("Hindsight delete document is unavailable in this client");
      const result = await client.deleteDocument(bankId, args.documentId);
      return { bankId, documentId: args.documentId, result };
    },
  };
}
