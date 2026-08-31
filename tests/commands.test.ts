import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config/config.js";
import { registerCommands } from "../extensions/tui/commands.js";
import { createOperationCatalog } from "../extensions/operations/operation-catalog.js";
import { createMemoryOperations } from "../extensions/operations/memory-operation-service.js";
import { readSessionMemoryMeta } from "../extensions/utils/session-memory-meta.js";
import type { HindsightLikeClient } from "../extensions/types.js";
import { writeFileSync } from "node:fs";

type RegisteredTestCommand = {
  handler: (args: unknown, ctx: any) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => unknown;
};

function client(overrides: Partial<HindsightLikeClient> = {}): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
    ...overrides,
  };
}

describe("hindsight public command surface", () => {
  it("registers only the /hindsight TUI hub command", () => {
    const commands = new Map<string, RegisteredTestCommand>();
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });
    registerCommands(
      {
        registerCommand: (name: string, command: RegisteredTestCommand) => {
          commands.set(name, command);
        },
      } as any,
      catalog,
    );

    expect([...commands.keys()].sort()).toEqual(["hindsight", "hindsight:next-opt-out"]);
    expect(commands.get("hindsight")?.handler).toBeTypeOf("function");
    expect(commands.get("hindsight:next-opt-out")?.handler).toBeTypeOf("function");
  });

  it("catalog command list matches the public TUI-first surface", () => {
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });
    expect(catalog.commands.map((command) => command.name)).toEqual([
      "hindsight",
      "hindsight:next-opt-out",
    ]);
    // Demoted slash commands must not reappear as public registrations.
    for (const demoted of [
      "hindsight:init",
      "hindsight:import",
      "hindsight:import-current",
      "hindsight:import-file",
      "hindsight:import-project-sessions",
      "hindsight:session",
      "hindsight:mode",
      "hindsight:retain",
      "hindsight:tag",
      "hindsight:last-recall",
      "hindsight:recall-cleanup",
      "hindsight:queue",
      "hindsight:flush",
      "hindsight:doctor",
      "hindsight:templates",
      "hindsight:template-apply",
    ]) {
      expect(catalog.commands.find((command) => command.name === demoted)).toBeUndefined();
    }
  });

  it("sets next opt-out via the public slash command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-next-opt-"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(sessionFile, "");
    const commands = new Map<string, RegisteredTestCommand>();
    const catalog = createOperationCatalog({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });
    registerCommands(
      {
        registerCommand: (name: string, command: RegisteredTestCommand) => {
          commands.set(name, command);
        },
      } as any,
      catalog,
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };
    await commands.get("hindsight:next-opt-out")?.handler([], ctx);
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("nextRetain=off"), "info");
  });
});

describe("session memory ops used by the TUI hub", () => {
  it("sets session mode and next opt-out through shared operations", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(sessionFile, "");
    const operations = createMemoryOperations({
      getClient: () => client(),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    await operations.setNextRetainOff(cwd, sessionFile);
    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");

    const modeResult = await operations.setSessionMode(cwd, sessionFile, "read-only");
    expect(modeResult.meta.mode).toBe("read-only");
    expect(modeResult.effective.mode).toBe("read-only");
    const session = await operations.session(cwd, sessionFile);
    expect(session.meta.mode).toBe("read-only");
    expect(session.effective.mode).toBe("read-only");
  });
});

describe("mental model template ops used by the TUI hub", () => {
  it("lists agent-use templates and dry-run gates apply", async () => {
    const importBankTemplate = vi.fn(async (_bankId, _manifest, options) => ({
      config_applied: true,
      mental_models_created: [],
      mental_models_updated: [],
      directives_created: [],
      directives_updated: [],
      dry_run: options?.dryRun ?? true,
    }));
    const operations = createMemoryOperations({
      getClient: () => client({ importBankTemplate }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });

    const listed = operations.listBankTemplatesForAgentUse();
    expect(listed.every((template) => template.agentUse === "coding")).toBe(true);

    const dryRun = await operations.applyBankTemplate({
      templateId: "pi-coding-project",
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(importBankTemplate).toHaveBeenCalledWith(
      "bank",
      expect.objectContaining({ version: "1" }),
      { dryRun: true },
    );

    const applied = await operations.applyBankTemplate({
      templateId: "pi-coding-project",
      dryRun: false,
    });
    expect(applied.dryRun).toBe(false);
    expect(importBankTemplate).toHaveBeenLastCalledWith(
      "bank",
      expect.objectContaining({ version: "1" }),
      { dryRun: false },
    );
  });

  it("rejects unknown template ids", async () => {
    const operations = createMemoryOperations({
      getClient: () => client({ importBankTemplate: async () => ({}) }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "bank",
    });
    await expect(operations.applyBankTemplate({ templateId: "nope" })).rejects.toThrow(
      /Unknown bank template id/,
    );
  });
});
