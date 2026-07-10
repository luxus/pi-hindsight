import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { PI_HINDSIGHT_USER_AGENT } from "../extensions/version.js";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  retain: vi.fn(async () => ({ accepted: true })),
  retainBatch: vi.fn(async () => ({ accepted: true })),
  listMentalModels: vi.fn(async () => ({ mental_models: [] })),
  getMentalModel: vi.fn(async () => ({ id: "mm1" })),
  createMentalModel: vi.fn(async () => ({ id: "mm1" })),
  updateMentalModel: vi.fn(async () => ({ id: "mm1" })),
  refreshMentalModel: vi.fn(async () => ({ id: "mm1" })),
  deleteMentalModel: vi.fn(async () => undefined),
  updateBankConfig: vi.fn(async () => ({ bank_id: "bank" })),
  getBankConfig: vi.fn(async () => ({ bank_id: "bank" })),
}));

vi.mock("@vectorize-io/hindsight-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vectorize-io/hindsight-client")>();
  return {
    ...actual,
    HindsightClient: vi.fn(function (options) {
      mocks.constructor(options);
      return {
        retain: mocks.retain,
        retainBatch: mocks.retainBatch,
        listMentalModels: mocks.listMentalModels,
        getMentalModel: mocks.getMentalModel,
        createMentalModel: mocks.createMentalModel,
        updateMentalModel: mocks.updateMentalModel,
        refreshMentalModel: mocks.refreshMentalModel,
        deleteMentalModel: mocks.deleteMentalModel,
        updateBankConfig: mocks.updateBankConfig,
        getBankConfig: mocks.getBankConfig,
      };
    }),
  };
});

describe("Hindsight client adapter", () => {
  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.retain.mockClear();
    mocks.retainBatch.mockClear();
    mocks.listMentalModels.mockClear();
    mocks.getMentalModel.mockClear();
    mocks.createMentalModel.mockClear();
    mocks.updateMentalModel.mockClear();
    mocks.refreshMentalModel.mockClear();
    mocks.deleteMentalModel.mockClear();
    mocks.updateBankConfig.mockClear();
    mocks.getBankConfig.mockClear();
  });

  it("uses official retain for single memories when document tags are absent", async () => {
    const { createHindsightClient } = await import("../extensions/client/client.js");
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
    const { createHindsightClient } = await import("../extensions/client/client.js");
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

  it("wraps mental-model and bank-config control-plane methods", async () => {
    const { createHindsightClient } = await import("../extensions/client/client.js");
    const client = createHindsightClient(DEFAULT_CONFIG);

    await client.listMentalModels!("bank", { tags: ["project:a"] });
    expect(mocks.listMentalModels).toHaveBeenCalledWith(
      "bank",
      expect.objectContaining({ tags: ["project:a"], signal: expect.any(AbortSignal) }),
    );

    await client.getMentalModel!("bank", "mm1");
    expect(mocks.getMentalModel).toHaveBeenCalledWith(
      "bank",
      "mm1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await client.createMentalModel!("bank", "Arch", "query", { tags: ["source:pi"] });
    expect(mocks.createMentalModel).toHaveBeenCalledWith(
      "bank",
      "Arch",
      "query",
      expect.objectContaining({ tags: ["source:pi"], signal: expect.any(AbortSignal) }),
    );

    await client.updateMentalModel!("bank", "mm1", { name: "Arch2" });
    expect(mocks.updateMentalModel).toHaveBeenCalledWith(
      "bank",
      "mm1",
      expect.objectContaining({ name: "Arch2", signal: expect.any(AbortSignal) }),
    );

    await client.refreshMentalModel!("bank", "mm1");
    expect(mocks.refreshMentalModel).toHaveBeenCalledWith(
      "bank",
      "mm1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const dry = await client.deleteMentalModel!("bank", "mm1", { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, wouldDelete: true });
    expect(mocks.deleteMentalModel).not.toHaveBeenCalled();

    await client.deleteMentalModel!("bank", "mm1", { dryRun: false });
    expect(mocks.deleteMentalModel).toHaveBeenCalledWith(
      "bank",
      "mm1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await client.updateBankConfig!("bank", { retainMission: "code" });
    expect(mocks.updateBankConfig).toHaveBeenCalledWith(
      "bank",
      expect.objectContaining({ retainMission: "code", signal: expect.any(AbortSignal) }),
    );

    await client.getBankConfig!("bank");
    expect(mocks.getBankConfig).toHaveBeenCalledWith(
      "bank",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
