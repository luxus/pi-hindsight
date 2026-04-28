import { describe, expect, it, vi } from "vitest";
import { ensureGlobalBank, ensureProjectBank } from "../extensions/bank-operations.js";
import type { HindsightLikeClient } from "../extensions/types.js";

function client(createBank = vi.fn(async () => undefined)): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    createBank,
  };
}

describe("bank operations", () => {
  it("uses configured project mission for reflect and retain missions", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client(createBank), "project-bank", { mission: "Project mission" });

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({
        name: "project-bank",
        reflectMission: "Project mission",
        retainMission: "Project mission",
        retainExtractionMode: "concise",
        enableObservations: true,
      }),
    );
  });

  it("passes configured observation enablement", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client(createBank), "project-bank", { enableObservations: false });

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({ enableObservations: false }),
    );
  });

  it("uses configured global mission when global bank is ensured", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureGlobalBank(client(createBank), "global-bank", { mission: "Global mission" });

    expect(createBank).toHaveBeenCalledWith(
      "global-bank",
      expect.objectContaining({
        name: "global-bank",
        reflectMission: "Global mission",
        retainMission: "Global mission",
      }),
    );
  });

  it("keeps default project mission when no mission is configured", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureProjectBank(client(createBank), "project-bank");

    expect(createBank).toHaveBeenCalledWith(
      "project-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("project-specific architecture"),
        retainMission: expect.stringContaining("durable project memory"),
      }),
    );
  });

  it("keeps global default mission focused on cross-project memory", async () => {
    const createBank = vi.fn(async () => undefined);
    await ensureGlobalBank(client(createBank), "global-bank");

    expect(createBank).toHaveBeenCalledWith(
      "global-bank",
      expect.objectContaining({
        reflectMission: expect.stringContaining("cross-project user preferences"),
        retainMission: expect.stringContaining("Do not retain repo-specific code facts"),
        retainExtractionMode: "concise",
        enableObservations: true,
      }),
    );
  });
});
