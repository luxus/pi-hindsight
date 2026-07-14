import { describe, expect, it, vi } from "vitest";
import { ensureGlobalBank, ensureProjectBank } from "../extensions/banks/bank-operations.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(
  args: {
    createBank?: HindsightLikeClient["createBank"];
    getBankProfile?: HindsightLikeClient["getBankProfile"];
  } = {},
): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    createBank: args.createBank ?? vi.fn(async () => undefined),
    getBankProfile:
      args.getBankProfile ??
      vi.fn(async () => {
        throw new Error("not found");
      }),
  };
}

describe("bank operations", () => {
  it("uses only explicit project mission fields for Hindsight bank missions", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank", {
      retainMission: "Retain mission",
      reflectMission: "Reflect mission",
      observationsMission: "Observation mission",
    });

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({
        reflectMission: "Reflect mission",
        retainMission: "Retain mission",
        observationsMission: "Observation mission",
      }),
    );
    const options = (createBank.mock.calls as unknown[][])[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(options).not.toHaveProperty("mission");
  });

  it("does not use generic mission shorthand for Hindsight bank missions", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank", {
      mission: "Generic mission",
    } as never);

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("senior developer"),
        retainMission: expect.stringContaining("technical decisions"),
        observationsMission: expect.stringContaining("durable project patterns"),
      }),
    );
    const options = (createBank.mock.calls as unknown[][])[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(JSON.stringify(options)).not.toContain("Generic mission");
  });

  it("passes configured observation enablement", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank", { enableObservations: false });

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({ enableObservations: false }),
    );
  });

  it("passes retainStructuredChunkSize to createBank when configured", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank", {
      retainStructuredChunkSize: 4000,
    });

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({ retainStructuredChunkSize: 4000 }),
    );
  });

  it("omits retainStructuredChunkSize from createBank when not configured", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank");

    const options = (createBank.mock.calls as unknown[][])[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(options).not.toHaveProperty("retainStructuredChunkSize");
  });

  it("uses only explicit global mission fields when global bank is created", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureGlobalBank(client({ createBank }), "global-bank", {
      retainMission: "Global retain",
      reflectMission: "Global reflect",
      observationsMission: "Global observations",
    });

    expect(createBank).toHaveBeenCalledWith(
      "global-bank",
      expect.objectContaining({
        name: "global-bank",
        reflectMission: "Global reflect",
        retainMission: "Global retain",
        observationsMission: "Global observations",
      }),
    );
    const options = (createBank.mock.calls as unknown[][])[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(options).not.toHaveProperty("mission");
  });

  it("keeps default project mission when no explicit mission fields are configured", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client({ createBank }), "project-bank");

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("senior developer"),
        retainMission: expect.stringContaining("technical decisions"),
        observationsMission: expect.stringContaining("durable project patterns"),
      }),
    );
  });

  it("keeps global default mission focused on cross-project memory", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureGlobalBank(client({ createBank }), "global-bank");

    expect(createBank).toHaveBeenCalledWith(
      "global-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("cross-project context"),
        retainMission: expect.stringContaining("repo-specific code facts"),
        observationsMission: expect.stringContaining("cross-project preferences"),
        retainExtractionMode: "concise",
        enableObservations: true,
      }),
    );
  });

  it("uses life missions when ensuring a conversation user bank", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureGlobalBank(client({ createBank }), "life-bank", { agentUse: "conversation" });

    expect(createBank).toHaveBeenCalledWith(
      "life-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("personal assistant"),
        retainMission: expect.stringContaining("life-task memory"),
        observationsMission: expect.stringContaining("life and task patterns"),
      }),
    );
  });

  it("does not overwrite missions when bank profile already exists", async () => {
    const createBank = vi.fn(async () => undefined);
    const getBankProfile = vi.fn(async () => ({ bankId: "project-bank" }));

    await ensureProjectBank(client({ createBank, getBankProfile }), "project-bank");

    expect(getBankProfile).toHaveBeenCalledWith("project-bank");
    expect(createBank).not.toHaveBeenCalled();
  });

  it("creates bank when profile lookup confirms not found", async () => {
    const createBank = vi.fn(async () => undefined);
    const getBankProfile = vi.fn(async () => {
      throw new Error("Hindsight request failed with status 404");
    });

    await ensureProjectBank(client({ createBank, getBankProfile }), "project-bank");

    expect(createBank).toHaveBeenCalledWith("project-bank", expect.any(Object));
  });

  it("surfaces non-404 profile lookup failures without creating a bank", async () => {
    const createBank = vi.fn(async () => undefined);
    const getBankProfile = vi.fn(async () => {
      throw new Error("Hindsight request failed with status 500");
    });

    await expect(
      ensureProjectBank(client({ createBank, getBankProfile }), "project-bank"),
    ).rejects.toThrow("status 500");

    expect(createBank).not.toHaveBeenCalled();
  });

  it("does not create bank without profile lookup capability", async () => {
    const createBank = vi.fn(async () => undefined);
    const noProfileClient = client({ createBank });
    delete noProfileClient.getBankProfile;

    await ensureProjectBank(noProfileClient, "project-bank");

    expect(createBank).not.toHaveBeenCalled();
  });
});
