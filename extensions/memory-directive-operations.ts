import { resolveOperationBank } from "./bank-selection.js";
import type {
  CreateDirectiveRequest,
  ListDirectivesOptions,
  UpdateDirectiveRequest,
} from "./types.js";
import type { MemoryOperationsDeps } from "./memory-operation-types.js";

function unavailable(name: string): Error {
  return new Error(`Hindsight client does not support directive ${name}.`);
}

function operationBank(deps: MemoryOperationsDeps, requestedBank?: string): string {
  return resolveOperationBank({
    requestedBank,
    config: deps.getConfig(),
    projectBankId: deps.getProjectBankId(),
  });
}

export function createDirectiveOperations(deps: MemoryOperationsDeps) {
  return {
    async listDirectives(args: { bank?: string; options?: ListDirectivesOptions } = {}) {
      const client = deps.getClient();
      if (!client.listDirectives) throw unavailable("list");
      const bankId = operationBank(deps, args.bank);
      const result = await client.listDirectives(bankId, args.options);
      return { bankId, result };
    },

    async getDirective(args: { bank?: string; directiveId: string }) {
      const client = deps.getClient();
      if (!client.getDirective) throw unavailable("get");
      const bankId = operationBank(deps, args.bank);
      const result = await client.getDirective(bankId, args.directiveId);
      return { bankId, directiveId: args.directiveId, result };
    },

    async createDirective(args: { bank?: string; request: CreateDirectiveRequest }) {
      const client = deps.getClient();
      if (!client.createDirective) throw unavailable("create");
      const bankId = operationBank(deps, args.bank);
      const result = await client.createDirective(bankId, args.request);
      return { bankId, result };
    },

    async updateDirective(args: {
      bank?: string;
      directiveId: string;
      request: UpdateDirectiveRequest;
    }) {
      const client = deps.getClient();
      if (!client.updateDirective) throw unavailable("update");
      const bankId = operationBank(deps, args.bank);
      const result = await client.updateDirective(bankId, args.directiveId, args.request);
      return { bankId, directiveId: args.directiveId, result };
    },

    async deleteDirective(args: { bank?: string; directiveId: string }) {
      const client = deps.getClient();
      if (!client.deleteDirective) throw unavailable("delete");
      const bankId = operationBank(deps, args.bank);
      const result = await client.deleteDirective(bankId, args.directiveId);
      return { bankId, directiveId: args.directiveId, result };
    },
  };
}
