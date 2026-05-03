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
