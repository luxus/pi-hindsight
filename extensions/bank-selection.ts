import type { ResolvedConfig } from "./types.js";

export function resolveOperationBank(args: {
  requestedBank: string | undefined;
  config: ResolvedConfig;
  projectBankId: string;
}): string {
  const requested = args.requestedBank?.trim();
  if (!requested || requested === "project") return args.projectBankId;
  if (requested === "global") {
    if (!args.config.banks.user.enabled)
      throw new Error("User Hindsight bank is disabled. Enable banks.user first.");
    if (!args.config.banks.user.bankId)
      throw new Error("User Hindsight bank ID is not configured.");
    return args.config.banks.user.bankId;
  }
  return requested;
}
