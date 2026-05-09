import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { PI_HINDSIGHT_USER_AGENT } from "../extensions/version.js";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  retain: vi.fn(async () => ({ accepted: true })),
  retainBatch: vi.fn(async () => ({ accepted: true })),
}));

vi.mock("@vectorize-io/hindsight-client", () => ({
  HindsightClient: vi.fn((options) => {
    mocks.constructor(options);
    return {
      retain: mocks.retain,
      retainBatch: mocks.retainBatch,
    };
  }),
}));

describe("Hindsight client adapter", () => {
  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.retain.mockClear();
    mocks.retainBatch.mockClear();
  });

  it("uses official retain for single memories when document tags are absent", async () => {
    const { createHindsightClient } = await import("../extensions/client.js");
    const client = createHindsightClient(DEFAULT_CONFIG);

    expect(mocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: PI_HINDSIGHT_USER_AGENT }),
    );

    await client.retain("bank", "content", {
      context: "ctx",
      documentId: "doc",
      updateMode: "append",
      observationScopes: [["repo:abc"]],
      async: true,
    });

    expect(mocks.retain).toHaveBeenCalledWith(
      "bank",
      "content",
      expect.objectContaining({
        context: "ctx",
        documentId: "doc",
        updateMode: "append",
        observationScopes: [["repo:abc"]],
        async: true,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.retainBatch).not.toHaveBeenCalled();
  });

  it("keeps retainBatch fallback when document tags are present", async () => {
    const { createHindsightClient } = await import("../extensions/client.js");
    const client = createHindsightClient(DEFAULT_CONFIG);

    await client.retain("bank", "content", {
      context: "ctx",
      documentId: "doc",
      documentTags: ["doc:tag"],
      updateMode: "append",
      observationScopes: [["repo:abc"]],
      async: false,
    });

    expect(mocks.retain).not.toHaveBeenCalled();
    expect(mocks.retainBatch).toHaveBeenCalledWith(
      "bank",
      [
        expect.objectContaining({
          content: "content",
          context: "ctx",
          document_id: "doc",
          update_mode: "append",
          observation_scopes: [["repo:abc"]],
        }),
      ],
      expect.objectContaining({
        async: false,
        documentTags: ["doc:tag"],
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
