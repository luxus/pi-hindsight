import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ResolvedConfig } from "./types.js";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operations.js";
import {
  DEFAULT_GLOBAL_BANK_ID,
  type MemoryProfile,
  type ProjectConfigPatchInput,
} from "./config-writer.js";

type Deps = MemoryOperationsDeps;

const DONE = "Done";
const CANCEL = "Cancel";

const LOCAL_EMBED_GUIDANCE = [
  "Local hindsight-embed guidance:",
  "uvx hindsight-embed@latest profile create pi --port 8888",
  "uvx hindsight-embed@latest -p pi bank create <bank-id>",
  "uvx hindsight-embed@latest -p pi ui start",
].join("\n");

function parsePositiveInt(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${field} must be a positive integer`);
  return parsed;
}

async function writeAndReload(
  ctx: ExtensionCommandContext,
  deps: Deps,
  patch: ProjectConfigPatchInput,
): Promise<void> {
  const result = await createMemoryOperations(deps).configure(ctx.cwd, patch);
  ctx.ui.notify(`Wrote ${result.path}`, "info");
}

function memoryProfileLabel(config: ResolvedConfig): MemoryProfile {
  if (!config.banks.project.enabled) return "global-only";
  if (config.banks.global.enabled) return "project+global";
  return "project-only";
}

function statusLines(config: ResolvedConfig, projectBankId: string): string[] {
  return [
    `enabled: ${config.enabled}`,
    `baseUrl: ${config.hindsight.baseUrl}`,
    `timeoutMs: ${config.hindsight.timeoutMs}`,
    `memory profile: ${memoryProfileLabel(config)}`,
    `projectBankId: ${projectBankId}${config.banks.project.bankId ? " (configured)" : " (auto)"}`,
    `project mission: ${config.banks.project.mission ? "configured" : "default"}`,
    `global: ${config.banks.global.enabled ? (config.banks.global.bankId ?? "enabled, no id") : "disabled"}`,
    `global mission: ${config.banks.global.mission ? "configured" : "default"}`,
    `observations: ${config.observations.enabled ? "enabled" : "disabled"}, scopes=${config.observations.scopes.length}`,
    `recall: ${config.recall.enabled}, ${config.recall.budget}, ${config.recall.maxTokens} tokens`,
    `retain: ${config.retain.enabled}, async=${config.retain.async}, update=${config.retain.updateMode}`,
    `queuePath: ${config.retain.queuePath}`,
    `import branches: ${config.import.includeBranches}`,
    `import manifest: ${config.import.manifestPath}`,
    `status: ${config.status.style}, ${config.status.detail}, max=${config.status.maxLength}, activity=${config.status.showActivity}`,
    `notifications: startup=${config.notifications.startup}, recall=${config.notifications.recall}, retain=${config.notifications.retain}`,
  ];
}

export async function runHindsightSetupTui(
  ctx: ExtensionCommandContext,
  deps: Deps,
): Promise<void> {
  while (true) {
    const config = deps.getConfig();
    const projectBankId = deps.getProjectBankId();
    const choice = await ctx.ui.select("Hindsight setup", [
      ...statusLines(config, projectBankId).map((line) => `· ${line}`),
      "Choose Hindsight deployment",
      "Set project memory bank ID",
      "Set Hindsight base URL",
      "Set API key env reference",
      "Set timeout (ms)",
      config.enabled ? "Disable extension" : "Enable extension",
      "Choose memory scope profile",
      config.banks.global.enabled ? "Disable global bank" : "Enable global bank",
      "Set global bank ID",
      config.recall.enabled ? "Disable recall" : "Enable recall",
      "Set recall budget",
      "Set recall token budget",
      config.retain.enabled ? "Disable retain" : "Enable retain",
      config.retain.async ? "Use sync retain flush" : "Use async retain mode",
      "Set durable retain queue path",
      "Set import branch mode",
      "Set import manifest path",
      "Set status style",
      "Set status detail",
      "Set status max length",
      config.status.showActivity ? "Hide status activity" : "Show status activity",
      config.notifications.startup ? "Hide startup notification" : "Show startup notification",
      config.notifications.recall ? "Hide recall notifications" : "Show recall notifications",
      config.notifications.retain ? "Hide retain notifications" : "Show retain notifications",
      DONE,
      CANCEL,
    ]);

    if (!choice || choice === CANCEL || choice === DONE) return;
    if (choice.startsWith("· ")) continue;

    try {
      if (choice === "Choose Hindsight deployment") {
        const value = await ctx.ui.select("Hindsight deployment", [
          "Hindsight Cloud",
          "Existing local/external API",
          "Local hindsight-embed guidance",
          CANCEL,
        ]);
        if (value === "Hindsight Cloud") {
          const baseUrl = await ctx.ui.input("Hindsight Cloud base URL", config.hindsight.baseUrl);
          if (baseUrl) await writeAndReload(ctx, deps, { baseUrl: baseUrl.trim() });
          const envName = await ctx.ui.input("API key env var name", "HINDSIGHT_API_KEY");
          if (envName) await writeAndReload(ctx, deps, { apiKeyEnvVar: envName.trim() });
          ctx.ui.notify("Cloud profile selected. API key stored as env SecretRef.", "info");
        } else if (value === "Existing local/external API") {
          const baseUrl = await ctx.ui.input("Hindsight API base URL", config.hindsight.baseUrl);
          if (baseUrl) await writeAndReload(ctx, deps, { baseUrl: baseUrl.trim() });
        } else if (value === "Local hindsight-embed guidance") {
          ctx.ui.notify(LOCAL_EMBED_GUIDANCE, "info");
          const useDefault = await ctx.ui.select("Set base URL to http://localhost:8888?", [
            "Yes",
            "No",
            CANCEL,
          ]);
          if (useDefault === "Yes")
            await writeAndReload(ctx, deps, { baseUrl: "http://localhost:8888" });
        }
      } else if (choice === "Set project memory bank ID") {
        const value = await ctx.ui.input("Project memory bank ID", projectBankId);
        if (value) await writeAndReload(ctx, deps, { projectBankId: value.trim() });
      } else if (choice === "Set Hindsight base URL") {
        const value = await ctx.ui.input("Hindsight base URL", config.hindsight.baseUrl);
        if (value) await writeAndReload(ctx, deps, { baseUrl: value.trim() });
      } else if (choice === "Set API key env reference") {
        const value = await ctx.ui.input("API key env var name", "HINDSIGHT_API_KEY");
        if (value) await writeAndReload(ctx, deps, { apiKeyEnvVar: value.trim() });
      } else if (choice === "Set timeout (ms)") {
        const value = await ctx.ui.input(
          "Timeout in milliseconds",
          String(config.hindsight.timeoutMs),
        );
        const timeoutMs = parsePositiveInt(value, "timeoutMs");
        if (timeoutMs !== undefined) await writeAndReload(ctx, deps, { timeoutMs });
      } else if (choice === "Disable extension" || choice === "Enable extension") {
        await writeAndReload(ctx, deps, { enabled: choice === "Enable extension" });
      } else if (choice === "Choose memory scope profile") {
        const value = await ctx.ui.select("Memory scope profile", [
          "project-only",
          "project+global",
          "global-only",
          CANCEL,
        ]);
        if (value && value !== CANCEL) {
          await writeAndReload(ctx, deps, {
            memoryProfile: value as MemoryProfile,
            globalBankId: config.banks.global.bankId ?? DEFAULT_GLOBAL_BANK_ID,
          });
        }
      } else if (choice === "Disable global bank" || choice === "Enable global bank") {
        await writeAndReload(ctx, deps, { enableGlobalBank: choice === "Enable global bank" });
      } else if (choice === "Set global bank ID") {
        const value = await ctx.ui.input("Global bank ID", config.banks.global.bankId ?? "");
        if (value) await writeAndReload(ctx, deps, { globalBankId: value.trim() });
      } else if (choice === "Disable recall" || choice === "Enable recall") {
        await writeAndReload(ctx, deps, { recallEnabled: choice === "Enable recall" });
      } else if (choice === "Set recall budget") {
        const value = await ctx.ui.select("Recall budget", ["low", "mid", "high", CANCEL]);
        if (value && value !== CANCEL)
          await writeAndReload(ctx, deps, { recallBudget: value as "low" | "mid" | "high" });
      } else if (choice === "Set recall token budget") {
        const value = await ctx.ui.input("Recall max tokens", String(config.recall.maxTokens));
        const recallMaxTokens = parsePositiveInt(value, "recallMaxTokens");
        if (recallMaxTokens !== undefined) await writeAndReload(ctx, deps, { recallMaxTokens });
      } else if (choice === "Disable retain" || choice === "Enable retain") {
        await writeAndReload(ctx, deps, { retainEnabled: choice === "Enable retain" });
      } else if (choice === "Use sync retain flush" || choice === "Use async retain mode") {
        await writeAndReload(ctx, deps, { retainAsync: choice === "Use async retain mode" });
      } else if (choice === "Set durable retain queue path") {
        const value = await ctx.ui.input("Retain queue path", config.retain.queuePath);
        if (value) await writeAndReload(ctx, deps, { queuePath: value.trim() });
      } else if (choice === "Set import branch mode") {
        const value = await ctx.ui.select("Import branch mode", [
          "current-only",
          "all-leaves",
          CANCEL,
        ]);
        if (value && value !== CANCEL)
          await writeAndReload(ctx, deps, {
            importIncludeBranches: value as "current-only" | "all-leaves",
          });
      } else if (choice === "Set import manifest path") {
        const value = await ctx.ui.input("Import manifest path", config.import.manifestPath);
        if (value) await writeAndReload(ctx, deps, { importManifestPath: value.trim() });
      } else if (choice === "Set status style") {
        const value = await ctx.ui.select("Status style", [
          "off",
          "text",
          "emoji",
          "nerdfont",
          CANCEL,
        ]);
        if (value && value !== CANCEL)
          await writeAndReload(ctx, deps, {
            statusStyle: value as "off" | "text" | "emoji" | "nerdfont",
          });
      } else if (choice === "Set status detail") {
        const value = await ctx.ui.select("Status detail", [
          "minimal",
          "project",
          "activity",
          "verbose",
          CANCEL,
        ]);
        if (value && value !== CANCEL)
          await writeAndReload(ctx, deps, {
            statusDetail: value as "minimal" | "project" | "activity" | "verbose",
          });
      } else if (choice === "Set status max length") {
        const value = await ctx.ui.input("Status max length", String(config.status.maxLength));
        const statusMaxLength = parsePositiveInt(value, "statusMaxLength");
        if (statusMaxLength !== undefined) await writeAndReload(ctx, deps, { statusMaxLength });
      } else if (choice === "Hide status activity" || choice === "Show status activity") {
        await writeAndReload(ctx, deps, { statusShowActivity: choice === "Show status activity" });
      } else if (choice === "Hide startup notification" || choice === "Show startup notification") {
        await writeAndReload(ctx, deps, { notifyStartup: choice === "Show startup notification" });
      } else if (choice === "Hide recall notifications" || choice === "Show recall notifications") {
        await writeAndReload(ctx, deps, { notifyRecall: choice === "Show recall notifications" });
      } else if (choice === "Hide retain notifications" || choice === "Show retain notifications") {
        await writeAndReload(ctx, deps, { notifyRetain: choice === "Show retain notifications" });
      }
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}
