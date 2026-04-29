import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { registerCommands } from "../extensions/commands.js";
import { setSessionMemoryMode } from "../extensions/session-memory-meta.js";
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
      `Hindsight last recall 2026-04-27T00:00:00.000Z; memories=2; banks=bank:2; query=user: q; path=${join(cwd, ".pi", "hindsight", "last-recall.json")}; visibility-only, not provider cache`,
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

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(`"path": "${join(cwd, ".pi", "hindsight", "last-recall.json")}"`),
      "info",
    );
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
      expect.stringContaining(
        "Import preview: current session; messages=1; documents=1; update=replace; status=pending; write=no",
      ),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("manifest unchanged="),
      "info",
    );
  });

  it("warns when status cannot read the retain queue", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    writeFileSync(join(cwd, "not-a-dir"), "file blocks queue directory");
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
        getConfig: () => ({
          ...DEFAULT_CONFIG,
          retain: { ...DEFAULT_CONFIG.retain, queuePath: "not-a-dir/retain-queue.jsonl" },
        }),
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:status")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("queue unreadable:"),
      "warning",
    );
  });

  it("reports no-bank profile without calling it global-only", async () => {
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
        getConfig: () => ({
          ...DEFAULT_CONFIG,
          banks: {
            project: { enabled: false, derive: "repo" },
            global: { enabled: false },
          },
        }),
        getProjectBankId: () => "bank",
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:status")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("profile none; bank none"),
      "info",
    );
  });

  it("warns on corrupt import manifest in status and debug", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    mkdirSync(join(cwd, ".pi", "hindsight"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi/hindsight/import-manifest.json"),
      JSON.stringify({ imports: "bad" }),
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

    await commands.get("hindsight:status")?.handler([], ctx);
    await commands.get("hindsight:debug")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("import manifest unreadable:"),
      "warning",
    );
    const debugCall = vi
      .mocked(ctx.ui.notify)
      .mock.calls.find(([message]) => String(message).includes('"imports"'));
    expect(String(debugCall?.[0])).toContain('"error"');
    expect(String(debugCall?.[0])).toContain('"action"');
  });

  it("warns when doctor cannot read the retain queue", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-hindsight-commands-"));
    writeFileSync(join(cwd, "not-a-dir"), "file blocks queue directory");
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
        getConfig: () => ({
          ...DEFAULT_CONFIG,
          retain: { ...DEFAULT_CONFIG.retain, queuePath: "not-a-dir/retain-queue.jsonl" },
        }),
        getProjectBankId: () => "bank",
        getCapabilities: () => ({ appendUpdateMode: true, checkedAt: new Date().toISOString() }),
      },
    );
    const ctx = { cwd, ui: { notify: vi.fn(), setStatus: vi.fn() }, sessionManager: {} };

    await commands.get("hindsight:doctor")?.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("queue unreadable:"),
      "warning",
    );
  });
});
