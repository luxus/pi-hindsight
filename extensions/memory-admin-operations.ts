import { resolveOperationBank } from "./bank-selection.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";
import type { ListMemoriesOptions, ListOperationsOptions } from "./types.js";

function unsupported(name: string): Error {
  return new Error(`Hindsight client does not support ${name}.`);
}

function bankFor(deps: MemoryOperationsDeps, bank: string | undefined): string {
  const config = deps.getConfig();
  return resolveOperationBank({
    requestedBank: bank,
    config,
    projectBankId: deps.getProjectBankId(),
  });
}

export function createAdminOperations(deps: MemoryOperationsDeps) {
  return {
    async listOperations(args: { bank?: string; options?: ListOperationsOptions }) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.listOperations) throw unsupported("listOperations");
      const result = await client.listOperations(bankId, args.options);
      return { bankId, result };
    },

    async cancelOperation(args: { bank?: string; operationId: string; confirm: true }) {
      if (!args.confirm) throw new Error("Set confirm=true to cancel this Hindsight operation.");
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.cancelOperation) throw unsupported("cancelOperation");
      const result = await client.cancelOperation(bankId, args.operationId);
      return { bankId, operationId: args.operationId, result };
    },

    async retryOperation(args: { bank?: string; operationId: string }) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.retryOperation) throw unsupported("retryOperation");
      const result = await client.retryOperation(bankId, args.operationId);
      return { bankId, operationId: args.operationId, result };
    },

    async listMemories(args: { bank?: string; options?: ListMemoriesOptions }) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.listMemories) throw unsupported("listMemories");
      const result = await client.listMemories(bankId, args.options);
      return { bankId, result };
    },

    async getMemory(args: { bank?: string; memoryId: string }) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.getMemory) throw unsupported("getMemory");
      const result = await client.getMemory(bankId, args.memoryId);
      return { bankId, memoryId: args.memoryId, result };
    },

    async getChunk(args: { chunkId: string }) {
      const client = deps.getClient();
      if (!client.getChunk) throw unsupported("getChunk");
      const result = await client.getChunk(args.chunkId);
      return { chunkId: args.chunkId, result };
    },

    async getMemoryHistory(args: { bank?: string; memoryId: string }) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.getMemoryHistory) throw unsupported("getMemoryHistory");
      const result = await client.getMemoryHistory(bankId, args.memoryId);
      return { bankId, memoryId: args.memoryId, result };
    },

    async deleteMemoryObservations(args: { bank?: string; memoryId: string; confirm: true }) {
      if (!args.confirm)
        throw new Error("Set confirm=true to delete observations for this Hindsight memory.");
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.deleteMemoryObservations) throw unsupported("deleteMemoryObservations");
      const result = await client.deleteMemoryObservations(bankId, args.memoryId);
      return { bankId, memoryId: args.memoryId, result };
    },

    async triggerConsolidation(args: { bank?: string } = {}) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.triggerConsolidation) throw unsupported("triggerConsolidation");
      const result = await client.triggerConsolidation(bankId);
      return { bankId, result };
    },

    async recoverConsolidation(args: { bank?: string } = {}) {
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.recoverConsolidation) throw unsupported("recoverConsolidation");
      const result = await client.recoverConsolidation(bankId);
      return { bankId, result };
    },

    async clearObservations(args: { bank?: string; confirm: true }) {
      if (!args.confirm) throw new Error("Set confirm=true to clear observations for this bank.");
      const bankId = bankFor(deps, args.bank);
      const client = deps.getClient();
      if (!client.clearObservations) throw unsupported("clearObservations");
      const result = await client.clearObservations(bankId);
      return { bankId, result };
    },
  };
}
