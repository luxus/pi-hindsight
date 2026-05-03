export function envValue(name, env = process.env) {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function smokeConfig(env = process.env, now = Date.now()) {
  return {
    baseUrl: envValue("HINDSIGHT_BASE_URL", env) ?? "http://localhost:8888",
    apiKey: envValue("HINDSIGHT_API_KEY", env),
    bankId: envValue("PI_HINDSIGHT_SMOKE_BANK_ID", env) ?? `pi-hindsight-smoke-${now}`,
    attempts: Number(env.HINDSIGHT_SMOKE_ATTEMPTS ?? 20),
  };
}

export function smokeMarker(now = Date.now(), random = Math.random()) {
  return `pi-hindsight-smoke-${now}-${random.toString(16).slice(2)}`;
}

export function logStep(step, data = {}, output = console.log) {
  output(JSON.stringify({ step, ...data }));
}

export function createSmokeRecorder({ now = Date.now, output = console.log } = {}) {
  const startedAt = now();
  const steps = [];
  return {
    step(name, data = {}) {
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

export function renderSmokeSummary(entries, { title = "Hindsight smoke test" } = {}) {
  const lines = [`## ${title}`, "", "| Step | Duration | Details |", "| --- | ---: | --- |"];
  for (const entry of entries) {
    const { step, durationMs, ...details } = entry;
    lines.push(
      `| ${step} | ${durationMs}ms | ${Object.keys(details).length ? `\`${JSON.stringify(details).replaceAll("`", "\\`")}\`` : ""} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function writeGitHubSummary(markdown, env = process.env) {
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry(fn, predicate, options) {
  const { attempts, delayMs, onWait = () => undefined, failureMessage } = options;
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await fn();
    if (predicate(last)) return last;
    onWait({ attempt, delayMs, last });
    await sleep(delayMs);
  }
  const preview = JSON.stringify(last).slice(0, 1000);
  throw new Error(
    failureMessage
      ? failureMessage({ attempts, last, preview })
      : `retry predicate failed after ${attempts} attempts: ${preview}`,
  );
}
