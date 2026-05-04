import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { registerCommands } from "../extensions/commands.js";
import { readSessionMemoryMeta, setSessionMemoryMode } from "../extensions/session-memory-meta.js";
import type { HindsightLikeClient } from "../extensions/types.js";

type RegisteredTestCommand = {
  handler: (args: unknown, ctx: any) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => unknown;
};

function client(): HindsightLikeClient {
  return {
    retain: async () => undefined,
    recall: async () => [],
    reflect: async () => ({}),
  };
}

describe("hindsight commands", () => {
  it("sets and reports next opt-out session metadata", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    const sessionFile = join(cwd, "session.jsonl");
    const commands = new Map<string, RegisteredTestCommand>();
    registerCommands(
      {
        registerCommand: (name: string, command: RegisteredTestCommand) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:next-opt-out")?.handler([], ctx);

    expect((await readSessionMemoryMeta(cwd, sessionFile)).nextRetainMode).toBe("off");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Hindsight will skip automatic retain for the next agent run in this session. nextRetain=off",
      "info",
    );

    vi.mocked(ctx.ui.notify).mockClear();
    await commands.get("hindsight:session")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("nextRetain=off"), "info");
  });

  it("registers argument completions for fixed command arguments", async () => {
    const commands = new Map<string, RegisteredTestCommand>();
    registerCommands(
      {
        registerCommand: (name: string, command: RegisteredTestCommand) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );

    const completions = async (name: string, prefix: string) =>
      Promise.resolve(commands.get(name)?.getArgumentCompletions?.(prefix));

    await expect(completions("hindsight:mode", "re")).resolves.toEqual([
      { value: "read-only", label: "read-only" },
    ]);
    await expect(completions("hindsight:retain", "o")).resolves.toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    await expect(completions("hindsight:tag", "a")).resolves.toEqual([
      { value: "add", label: "add" },
    ]);
    await expect(completions("hindsight:import-current", "--d")).resolves.toEqual([
      { value: "--dry-run", label: "--dry-run" },
    ]);
    await expect(completions("hindsight:import-current", "--dry-run --a")).resolves.toEqual([
      { value: "--dry-run --all-leaves", label: "--all-leaves" },
    ]);
    await expect(completions("hindsight:last-recall", "")).resolves.toEqual([
      { value: "--json", label: "--json" },
    ]);
    await expect(completions("hindsight:recall-cleanup", "session.jsonl --p")).resolves.toEqual([
      { value: "session.jsonl --prune", label: "--prune" },
    ]);
  });

  it("reports missing last recall snapshot", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:last-recall")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No Hindsight recall snapshot"),
      "warning",
    );
  });

  it("warns on malformed last recall snapshot", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hindsight", "last-recall.json"), "not json");
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:last-recall")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Hindsight last recall snapshot unreadable"),
      "warning",
    );
  });

  it("reports last recall snapshot summary", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "hindsight", "last-recall.json"),
      JSON.stringify({
        createdAt: "2026-04-27T00:00:00.000Z",
        query: "user: q",
        rendered: "<hindsight-memory>m</hindsight-memory>",
        blocks: [{ bankId: "bank", query: "user: q", rendered: "", memoryCount: 2, results: [] }],
      }),
    );
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:last-recall")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      `Hindsight last recall 2026-04-27T00:00:00.000Z; memories=2; banks=bank:2; failed=0; failures=none; query=user: q; path=${join(cwd, ".pi", "hindsight", "last-recall.json")}; visibility-only, not provider cache`,
      "info",
    );
  });

  it("reports last recall snapshot as json when requested", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "hindsight", "last-recall.json"),
      JSON.stringify({
        createdAt: "2026-04-27T00:00:00.000Z",
        query: "user: q",
        rendered: "<hindsight-memory>m</hindsight-memory>",
        blocks: [{ bankId: "bank", query: "user: q", rendered: "", memoryCount: 2, results: [] }],
      }),
    );
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:last-recall")?.handler(["--json"], ctx);

    const json = JSON.parse(ctx.ui.notify.mock.calls[0]?.[0]);
    expect(json.path).toBe(join(cwd, ".pi", "hindsight", "last-recall.json"));
  });

  it("refuses to prune explicit active session transcript", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    const activeSession = join(cwd, "session.jsonl");
    const content = `${JSON.stringify({ type: "message", message: { content: "<hindsight-memory>m</hindsight-memory>" } })}\n`;
    writeFileSync(activeSession, content);
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => activeSession },
    };

    await commands.get("hindsight:recall-cleanup")?.handler([activeSession, "--prune"], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Refusing to prune"),
      "warning",
    );
    expect(readFileSync(activeSession, "utf8")).toBe(content);
  });

  it("reports requested and effective retain state under read-only mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    await setSessionMemoryMode(cwd, sessionFile, "read-only");
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:retain")?.handler(["on"], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Hindsight session retain requested=on; effective=off; mode=read-only",
      "info",
    );
  });

  it("shows dry-run import details without retaining", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => ({ retain, recall: async () => [], reflect: async () => ({}) }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:import-current")?.handler(["--dry-run"], ctx);

    expect(retain).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Starting Hindsight current session preview; branches=current branch; write=no",
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(
        "Import preview: current session; messages=1; documents=1; update=replace; status=pending; mode=curated; projected=1/1 messages; droppedToolResults=0",
      ),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("manifest unchanged="),
      "info",
    );
  });

  it("asks before writing project imports and cancels safely", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-project-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => ({ retain, recall: async () => [], reflect: async () => ({}) }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn(), select: vi.fn(async () => "Cancel") },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:import-project-sessions")?.handler([], ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith(expect.stringContaining("Project import preview:"), [
      "Import",
      "Cancel",
    ]);
    const selectCalls = ctx.ui.select.mock.calls as unknown[][];
    expect(selectCalls[0]?.[0]).toContain("write=no");
    expect(retain).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Hindsight import cancelled.", "warning");
  });

  it("writes project imports after confirmation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-project-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const retain = vi.fn(async () => undefined);
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => ({ retain, recall: async () => [], reflect: async () => ({}) }),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn(), select: vi.fn(async () => "Import") },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:import-project-sessions")?.handler([], ctx);

    expect(ctx.ui.select).toHaveBeenCalled();
    expect(retain).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Imported project sessions:"),
      "info",
    );
  });

  it("shows project import start notification before preview result", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".git"));
    const sessionFile = join(cwd, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session-project-import", cwd }),
        JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      ].join("\n"),
    );
    const commands = new Map<string, { handler: (args: unknown, ctx: any) => Promise<void> }>();
    registerCommands(
      {
        registerCommand: (
          name: string,
          command: { handler: (args: unknown, ctx: any) => Promise<void> },
        ) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );
    const ctx = {
      cwd,
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      sessionManager: { getSessionFile: () => sessionFile },
    };

    await commands.get("hindsight:import-project-sessions")?.handler(["--dry-run"], ctx);

    expect(ctx.ui.notify).toHaveBeenNthCalledWith(
      1,
      "Starting Hindsight project sessions preview; branches=current branch; write=no",
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("Project import preview:"),
      "info",
    );
  });

  it("registers /hindsight TUI command and removes legacy status/debug commands", async () => {
    const commands = new Map<string, RegisteredTestCommand>();
    registerCommands(
      {
        registerCommand: (name: string, command: RegisteredTestCommand) => {
          commands.set(name, command);
        },
      } as any,
      {
        getClient: () => client(),
        getConfig: () => DEFAULT_CONFIG,
        getProjectBankId: () => "bank",
      },
    );

    expect(commands.has("hindsight")).toBe(true);
    expect(commands.has("hindsight:status")).toBe(false);
    expect(commands.has("hindsight:doctor")).toBe(false);
    expect(commands.has("hindsight:config")).toBe(false);
    expect(commands.has("hindsight:debug")).toBe(false);
    expect(commands.has("hindsight:setup")).toBe(false);
  });
});
