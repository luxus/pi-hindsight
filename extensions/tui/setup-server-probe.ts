import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { checkHindsight, createHindsightClient } from "../client/client.js";
import type { MemoryOperationsDeps } from "../operations/memory-operation-service.js";
import { createMemoryOperations } from "../operations/memory-operation-service.js";
import type { HindsightLikeClient, ResolvedConfig } from "../types.js";
import { apiKeyEnvName } from "../config/config-editing-registry.js";

export const LOCAL_DEFAULT_BASE_URL = "http://localhost:8888";
const DOCS_BASE_URL = "https://luxus.github.io/pi-hindsight";
const CLOUD_SIGNUP_URL = "https://ui.hindsight.vectorize.io/signup";
const INSTALL_URL = "https://hindsight.vectorize.io/developer/installation";

export type ServerProbeResult = {
  ok: boolean;
  baseUrl: string;
  usedApiKey: boolean;
  error?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "") || LOCAL_DEFAULT_BASE_URL;
}

/** Ordered unique base URLs to try during guided setup. */
export function buildServerProbeCandidates(config: ResolvedConfig): string[] {
  const configured = normalizeBaseUrl(config.hindsight.baseUrl);
  const candidates = [configured];
  if (configured !== LOCAL_DEFAULT_BASE_URL) candidates.push(LOCAL_DEFAULT_BASE_URL);
  return [...new Set(candidates)];
}

export function hasResolvedApiKey(config: ResolvedConfig): boolean {
  return Boolean(config.hindsight.apiKey?.trim());
}

export function formatServerProbeDocs(): string {
  return [
    "Pi Hindsight docs:",
    `  Setup TUI: ${DOCS_BASE_URL}/start/setup-tui/`,
    `  Getting started: ${DOCS_BASE_URL}/start/getting-started/`,
    `  Minimal config: ${DOCS_BASE_URL}/start/minimal-config/`,
    `Hindsight server: ${INSTALL_URL}`,
    `Hindsight Cloud signup: ${CLOUD_SIGNUP_URL}`,
  ].join("\n");
}

export function formatServerProbeSuccess(result: ServerProbeResult): string {
  const key = result.usedApiKey ? "with API key" : "without API key";
  return `Hindsight server reachable at ${result.baseUrl} (${key}).`;
}

export function formatServerProbeFailure(args: {
  results: ServerProbeResult[];
  hasApiKey: boolean;
  apiKeyEnvLabel: string;
}): string {
  const lines = args.results.map((result) => {
    const key = result.usedApiKey ? "with key" : "no key";
    return `  • ${result.baseUrl} (${key}): ${result.error ?? "unreachable"}`;
  });
  return [
    "Could not reach a Hindsight server yet.",
    ...lines,
    `API key: ${args.hasApiKey ? "resolved" : `not set (${args.apiKeyEnvLabel})`}`,
    "",
    "Local embed often needs no key. Cloud / locked APIs need HINDSIGHT_API_KEY (or your env name).",
    "Cloud base URL comes from your Hindsight dashboard after signup — not a fixed public URL.",
  ].join("\n");
}

export async function probeHindsightBaseUrl(args: {
  config: ResolvedConfig;
  baseUrl: string;
  createClient?: (config: ResolvedConfig) => HindsightLikeClient;
  check?: typeof checkHindsight;
}): Promise<ServerProbeResult> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const createClient = args.createClient ?? createHindsightClient;
  const check = args.check ?? checkHindsight;
  const probeConfig: ResolvedConfig = {
    ...args.config,
    hindsight: { ...args.config.hindsight, baseUrl },
  };
  const client = createClient(probeConfig);
  const health = await check(client, "setup-probe");
  return {
    ok: health.ok,
    baseUrl,
    usedApiKey: hasResolvedApiKey(probeConfig),
    ...(health.error ? { error: health.error } : {}),
  };
}

export async function probeHindsightCandidates(args: {
  config: ResolvedConfig;
  /** When probing the configured URL, prefer the live runtime client (tests/hooks). */
  configuredClient?: HindsightLikeClient;
  createClient?: (config: ResolvedConfig) => HindsightLikeClient;
  check?: typeof checkHindsight;
}): Promise<{ ok: ServerProbeResult | undefined; attempts: ServerProbeResult[] }> {
  const attempts: ServerProbeResult[] = [];
  const check = args.check ?? checkHindsight;
  const configured = normalizeBaseUrl(args.config.hindsight.baseUrl);
  for (const baseUrl of buildServerProbeCandidates(args.config)) {
    let result: ServerProbeResult;
    if (baseUrl === configured && args.configuredClient) {
      const health = await check(args.configuredClient, "setup-probe");
      result = {
        ok: health.ok,
        baseUrl,
        usedApiKey: hasResolvedApiKey(args.config),
        ...(health.error ? { error: health.error } : {}),
      };
    } else {
      result = await probeHindsightBaseUrl({
        config: args.config,
        baseUrl,
        ...(args.createClient ? { createClient: args.createClient } : {}),
        ...(args.check ? { check: args.check } : {}),
      });
    }
    attempts.push(result);
    if (result.ok) return { ok: result, attempts };
  }
  return { ok: undefined, attempts };
}

/**
 * Guided-setup step: health-check Hindsight, recover base URL / API key env, show docs.
 * Returns false if the user cancels guided setup.
 */
export async function ensureServerConnectionForSetup(args: {
  ctx: ExtensionCommandContext;
  deps: MemoryOperationsDeps;
  cwd: string;
}): Promise<boolean> {
  const { ctx, deps, cwd } = args;
  ctx.ui.notify(formatServerProbeDocs(), "info");
  ctx.ui.notify("Checking Hindsight server connectivity…", "info");

  let config = deps.getConfig();
  let attempts = 0;
  const maxAttempts = 4;

  while (attempts < maxAttempts) {
    attempts += 1;
    const { ok, attempts: probeAttempts } = await probeHindsightCandidates({
      config,
      configuredClient: deps.getClient(),
    });
    if (ok) {
      // Persist working base URL when it differs from config (e.g. fallback localhost).
      if (normalizeBaseUrl(config.hindsight.baseUrl) !== ok.baseUrl) {
        await createMemoryOperations(deps).configure(cwd, { baseUrl: ok.baseUrl });
        deps.reloadConfig?.(cwd);
        config = deps.getConfig();
      }
      ctx.ui.notify(formatServerProbeSuccess(ok), "info");
      return true;
    }

    const apiKeyEnvLabel =
      apiKeyEnvName(config) !== "not set" ? apiKeyEnvName(config) : "HINDSIGHT_API_KEY";
    ctx.ui.notify(
      formatServerProbeFailure({
        results: probeAttempts,
        hasApiKey: hasResolvedApiKey(config),
        apiKeyEnvLabel,
      }),
      "warning",
    );

    if (!hasResolvedApiKey(config)) {
      const setKey = await ctx.ui.confirm(
        "Configure API key env var?",
        `No API key is resolved. Local servers often work without one. Cloud needs export ${apiKeyEnvLabel}=… then restart Pi. Save env var name to project config?`,
      );
      if (setKey) {
        const envName = await ctx.ui.input("API key environment variable name", apiKeyEnvLabel);
        if (envName?.trim()) {
          await createMemoryOperations(deps).configure(cwd, {
            apiKeyEnvVar: envName.trim(),
          });
          deps.reloadConfig?.(cwd);
          config = deps.getConfig();
          if (!hasResolvedApiKey(config)) {
            ctx.ui.notify(
              `Saved apiKey env ref “${envName.trim()}”, but it is not set in this process. Export it and restart Pi, or continue offline for config-only setup.`,
              "warning",
            );
          }
          continue;
        }
      }
    } else {
      const alt = await ctx.ui.confirm(
        "Try a different base URL?",
        "API key is set but the server was unreachable. Paste a Cloud/self-hosted API base URL from your Hindsight dashboard?",
      );
      if (alt) {
        const url = await ctx.ui.input(
          "Hindsight API base URL",
          config.hindsight.baseUrl || LOCAL_DEFAULT_BASE_URL,
        );
        if (url?.trim()) {
          await createMemoryOperations(deps).configure(cwd, { baseUrl: url.trim() });
          deps.reloadConfig?.(cwd);
          config = deps.getConfig();
          continue;
        }
      }
    }

    const choice = await ctx.ui.select("Server still unreachable", [
      "Retry health check",
      "Continue offline (config only)",
      "Cancel guided setup",
    ]);
    if (!choice || choice === "Cancel guided setup") return false;
    if (choice === "Retry health check") continue;
    ctx.ui.notify(
      "Continuing guided setup offline. Memory network ops will fail until a server is reachable.",
      "warning",
    );
    return true;
  }

  ctx.ui.notify(
    "Continuing guided setup after multiple connection attempts. Fix server/key later via /hindsight (d deployment).",
    "warning",
  );
  return true;
}
