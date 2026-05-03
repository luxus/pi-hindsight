export interface SmokeConfig {
  baseUrl: string;
  apiKey?: string;
  bankId: string;
  bankIsTemporary: boolean;
  attempts: number;
  cleanupTimeoutMs: number;
}

export interface SmokeEntry {
  step: string;
  durationMs: number;
  [key: string]: unknown;
}

export interface SmokeRecorder {
  step(name: string, data?: Record<string, unknown>): SmokeEntry;
  entries(): SmokeEntry[];
}

export function envValue(name: string, env: Record<string, string | undefined> = process.env) {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function smokeConfig(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): SmokeConfig {
  const configuredBankId = envValue("PI_HINDSIGHT_SMOKE_BANK_ID", env);
  const apiKey = envValue("HINDSIGHT_API_KEY", env);
  return {
    baseUrl: envValue("HINDSIGHT_BASE_URL", env) ?? "http://localhost:8888",
    ...(apiKey ? { apiKey } : {}),
    bankId: configuredBankId ?? `pi-hindsight-smoke-${now}`,
    bankIsTemporary: !configuredBankId,
    attempts: Number(env.HINDSIGHT_SMOKE_ATTEMPTS ?? 20),
    cleanupTimeoutMs: Number(env.HINDSIGHT_SMOKE_CLEANUP_TIMEOUT_MS ?? 5000),
  };
}

export function smokeMarker(now = Date.now(), random = Math.random()) {
  return `pi-hindsight-smoke-${now}-${random.toString(16).slice(2)}`;
}

export function logStep(
  step: string,
  data: Record<string, unknown> = {},
  output: (line: string) => void = console.log,
) {
  output(JSON.stringify({ step, ...data }));
}

export function createSmokeRecorder({
  now = Date.now,
  output = console.log,
}: { now?: () => number; output?: (line: string) => void } = {}): SmokeRecorder {
  const startedAt = now();
  const steps: SmokeEntry[] = [];
  return {
    step(name: string, data: Record<string, unknown> = {}) {
      const durationMs = now() - startedAt;
      const entry = { step: name, durationMs, ...data };
      steps.push(entry);
      logStep(name, { durationMs, ...data }, output);
      return entry;
    },
    entries() {
      return [...steps];
    },
  };
}

export function renderSmokeSummary(
  entries: SmokeEntry[],
  { title = "Hindsight smoke test" }: { title?: string } = {},
) {
  const lines = [`## ${title}`, "", "| Step | Duration | Details |", "| --- | ---: | --- |"];
  for (const entry of entries) {
    const { step, durationMs, ...details } = entry;
    lines.push(
      `| ${step} | ${durationMs}ms | ${Object.keys(details).length ? `\`${JSON.stringify(details).replaceAll("`", "\\`")}\`` : ""} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function deleteSmokeBank(
  config: Pick<SmokeConfig, "baseUrl" | "apiKey">,
  bankId: string,
  signal?: AbortSignal,
) {
  const headers = new Headers();
  headers.set("User-Agent", "pi-hindsight-smoke/0.1.0");
  if (config.apiKey) headers.set("Authorization", `Bearer ${config.apiKey}`);
  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, "")}/v1/default/banks/${encodeURIComponent(bankId)}`,
    { method: "DELETE", headers, ...(signal ? { signal } : {}) },
  );
  const body = await response.text().catch(() => "");
  if (!response.ok && response.status !== 404) {
    throw new Error(`delete bank failed with status ${response.status}: ${body.slice(0, 500)}`);
  }
  return { status: response.status };
}

function cleanupTimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

type CleanupSmokeConfig = Pick<SmokeConfig, "bankIsTemporary"> &
  Partial<Pick<SmokeConfig, "baseUrl" | "apiKey" | "cleanupTimeoutMs">>;

export async function cleanupSmokeBankOnSuccess({
  config,
  bankId,
  succeeded,
  recorder,
  deleteBank = deleteSmokeBank as (
    config: CleanupSmokeConfig,
    bankId: string,
    signal: AbortSignal,
  ) => Promise<{ status: number }>,
}: {
  config: CleanupSmokeConfig;
  bankId: string;
  succeeded: boolean;
  recorder: SmokeRecorder;
  deleteBank?: (
    config: CleanupSmokeConfig,
    bankId: string,
    signal: AbortSignal,
  ) => Promise<{ status: number }>;
}) {
  if (!succeeded) {
    recorder.step("cleanup_skipped", { reason: "smoke_failed", bankId });
    return { cleaned: false, reason: "smoke_failed" };
  }
  if (!config.bankIsTemporary) {
    recorder.step("cleanup_skipped", { reason: "configured_bank", bankId });
    return { cleaned: false, reason: "configured_bank" };
  }
  try {
    const result = await deleteBank(
      config,
      bankId,
      cleanupTimeoutSignal(config.cleanupTimeoutMs ?? 5000),
    );
    recorder.step("cleanup_ok", { bankId, status: result.status });
    return { cleaned: true, status: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recorder.step("cleanup_failed", { bankId, error: message });
    return { cleaned: false, reason: "delete_failed", error: message };
  }
}

export async function writeGitHubSummary(
  markdown: string,
  env: Record<string, string | undefined> = process.env,
) {
  const path = env.GITHUB_STEP_SUMMARY;
  if (!path) return { written: false };
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, markdown, "utf8");
    return { written: true };
  } catch (error) {
    return { written: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: {
    attempts: number;
    delayMs: number;
    onWait?: (args: { attempt: number; delayMs: number; last: T }) => void;
    failureMessage?: (args: { attempts: number; last: T; preview: string }) => string;
  },
) {
  const { attempts, delayMs, onWait = () => undefined, failureMessage } = options;
  let last: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await fn();
    if (predicate(last)) return last;
    onWait({ attempt, delayMs, last });
    await sleep(delayMs);
  }
  const preview = JSON.stringify(last).slice(0, 1000);
  throw new Error(
    failureMessage
      ? failureMessage({ attempts, last: last as T, preview })
      : `retry predicate failed after ${attempts} attempts: ${preview}`,
  );
}
