import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import hindsightExtension from "../extensions/index.js";
import { createOperationCatalog } from "../extensions/operations/operation-catalog.js";

const mocked = vi.hoisted(() => ({
  setupModuleLoads: 0,
  runHindsightSetupTui: vi.fn(async () => undefined),
  createMemoryOperations: vi.fn(() => ({
    status: vi.fn(async () => ({ connected: true })),
    setNextRetainOff: vi.fn(async () => ({ meta: { nextRetainMode: "off" } })),
  })),
}));

vi.mock("../extensions/lifecycle/memory-lifecycle.js", () => ({
  createMemoryLifecycle: () => ({
    deps: {
      getClient: () => ({}),
      getConfig: () => ({ enabled: true }),
      getProjectBankId: () => "test-bank",
    },
    initialize: vi.fn(),
    recall: vi.fn(),
    retain: vi.fn(),
    shutdown: vi.fn(),
  }),
}));

vi.mock("../extensions/operations/memory-operation-service.js", () => ({
  createMemoryOperations: mocked.createMemoryOperations,
}));

vi.mock("../extensions/tui/setup-tui.js", () => {
  mocked.setupModuleLoads += 1;
  return { runHindsightSetupTui: mocked.runHindsightSetupTui };
});

beforeEach(() => {
  vi.clearAllMocks();
});

it("registers the shared catalog through the extension entrypoint", () => {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };

  hindsightExtension(pi as never);

  expect(pi.registerTool.mock.calls.map(([tool]) => tool.name)).toContain("hindsight_recall");
  expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual([
    "hindsight",
    "hindsight:next-opt-out",
  ]);
  expect(mocked.createMemoryOperations).not.toHaveBeenCalled();
});

it("shares one lazy memory operation service across commands and tools", async () => {
  const catalog = createOperationCatalog({
    getClient: () => ({}) as never,
    getConfig: () => DEFAULT_CONFIG,
    getProjectBankId: () => "test-bank",
  });

  expect(mocked.createMemoryOperations).not.toHaveBeenCalled();

  const nextOptOut = catalog.commands.find((command) => command.name === "hindsight:next-opt-out");
  const context = {
    cwd: process.cwd(),
    ui: { notify: vi.fn() },
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
  } as never;
  await nextOptOut?.spec.handler("", context);

  const statusTool = catalog.tools.find((tool) => tool.name === "hindsight_status");
  expect(statusTool).toBeDefined();
  await statusTool?.execute("status", {}, undefined, undefined, context);

  expect(mocked.createMemoryOperations).toHaveBeenCalledTimes(1);
});

it("loads the setup TUI only when the hub command runs", async () => {
  const catalog = createOperationCatalog({
    getClient: () => ({}) as never,
    getConfig: () => DEFAULT_CONFIG,
    getProjectBankId: () => "test-bank",
  });

  expect(mocked.setupModuleLoads).toBe(0);
  const hub = catalog.commands.find((command) => command.name === "hindsight");
  await hub?.spec.handler("", { cwd: process.cwd() } as never);

  expect(mocked.setupModuleLoads).toBe(1);
  expect(mocked.runHindsightSetupTui).toHaveBeenCalledOnce();
});
