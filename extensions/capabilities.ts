import { redactError } from "./sanitize.js";
import type {
  HindsightCapabilities,
  HindsightLikeClient,
  ResolvedConfig,
  UpdateMode,
} from "./types.js";

export function resolveRetainDocumentTarget(args: {
  config: ResolvedConfig;
  capabilities?: HindsightCapabilities;
  documentId: string;
  updateMode: UpdateMode;
}): { documentId: string; updateMode: UpdateMode } {
  if (args.updateMode !== "append")
    return { documentId: args.documentId, updateMode: args.updateMode };
  if (!args.capabilities || args.capabilities.appendUpdateMode) {
    return { documentId: args.documentId, updateMode: args.updateMode };
  }
  throw new Error("Hindsight append update mode is unsupported. Upgrade Hindsight.");
}

export function isAppendUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const mentionsAppendMode = /append|update[_ ]?mode/i.test(message);
  const explicitUnsupported =
    /unsupported|invalid|unknown|unrecognized|not allowed|not permitted/i.test(message);
  const validationUnsupported =
    /update[_ ]?mode/i.test(message) &&
    /append/i.test(message) &&
    /input should be|expected|literal_error|permitted|allowed/i.test(message);
  return mentionsAppendMode && (explicitUnsupported || validationUnsupported);
}

export async function detectAppendCapability(
  client: HindsightLikeClient,
  bankId: string,
): Promise<HindsightCapabilities> {
  const checkedAt = new Date().toISOString();
  const documentId = `pi-hindsight-capability:append:${bankId}`;
  try {
    await client.retain(bankId, "Pi Hindsight append capability probe. Safe to ignore.", {
      async: true,
      documentId,
      updateMode: "append",
      context: "Pi Hindsight append capability detection",
      tags: ["source:pi-hindsight-diagnostic", "test:capability", "feature:append-probe"],
      metadata: {
        source: "pi-hindsight",
        capability: "append-update-mode",
      },
    });
    return { appendUpdateMode: true, checkedAt, probeDocumentId: documentId };
  } catch (error) {
    const message = redactError(error);
    const appendUnsupported = isAppendUnsupportedError(error);
    return {
      appendUpdateMode: !appendUnsupported,
      checkedAt,
      error: appendUnsupported
        ? message
        : `Probe inconclusive; assuming append support: ${message}`,
      probeDocumentId: documentId,
    };
  }
}
