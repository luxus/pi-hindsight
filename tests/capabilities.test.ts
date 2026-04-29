import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  detectAppendCapability,
  isAppendUnsupportedError,
  resolveRetainDocumentTarget,
} from "../extensions/capabilities.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(retain: HindsightLikeClient["retain"]): HindsightLikeClient {
  return {
    retain,
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("append capabilities", () => {
  it("detects append support with an isolated probe document", async () => {
    const calls: unknown[] = [];
    const capabilities = await detectAppendCapability(
      client(async (...args: unknown[]) => {
        calls.push(args);
      }),
      "bank",
    );

    expect(capabilities.appendUpdateMode).toBe(true);
    expect(capabilities.probeDocumentId).toBe("pi-hindsight-capability:append:bank");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([
      "bank",
      "Pi Hindsight append capability probe. Safe to ignore.",
      {
        async: true,
        documentId: "pi-hindsight-capability:append:bank",
        updateMode: "append",
        tags: ["source:pi-hindsight-diagnostic", "test:capability", "feature:append-probe"],
      },
    ]);
  });

  it("reports unsupported append when the probe fails with an append-specific error", async () => {
    const capabilities = await detectAppendCapability(
      client(async () => {
        throw new Error("update_mode append unsupported");
      }),
      "bank",
    );

    expect(capabilities.appendUpdateMode).toBe(false);
    expect(capabilities.error).toContain("append unsupported");
  });

  it("detects append validation errors from servers without append support", async () => {
    const error = new Error(
      `retain failed: [{"loc":["body","items",0,"update_mode"],"msg":"Input should be 'replace'","input":"append"}]`,
    );
    expect(isAppendUnsupportedError(error)).toBe(true);

    const capabilities = await detectAppendCapability(
      client(async () => {
        throw error;
      }),
      "bank",
    );
    expect(capabilities.appendUpdateMode).toBe(false);
  });

  it("does not mark generic probe failures as unsupported", async () => {
    const capabilities = await detectAppendCapability(
      client(async () => {
        throw new Error("ECONNREFUSED");
      }),
      "bank",
    );

    expect(capabilities.appendUpdateMode).toBe(true);
    expect(capabilities.error).toContain("Probe inconclusive");
  });

  it("keeps stable append document IDs when append is supported or unknown", () => {
    expect(
      resolveRetainDocumentTarget({
        config: DEFAULT_CONFIG,
        documentId: "doc",
        updateMode: "append",
      }),
    ).toEqual({ documentId: "doc", updateMode: "append" });

    expect(
      resolveRetainDocumentTarget({
        config: DEFAULT_CONFIG,
        capabilities: { appendUpdateMode: true, checkedAt: "now" },
        documentId: "doc",
        updateMode: "append",
      }),
    ).toEqual({ documentId: "doc", updateMode: "append" });
  });

  it("refuses append when unsupported", () => {
    expect(() =>
      resolveRetainDocumentTarget({
        config: DEFAULT_CONFIG,
        capabilities: { appendUpdateMode: false, checkedAt: "now" },
        documentId: "doc",
        updateMode: "append",
      }),
    ).toThrow(/append update mode is unsupported/);
  });
});
