#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piCli = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
const extensionPath = resolve(root, process.argv[2] ?? "extensions/index.ts");
const runCount = Number.parseInt(process.env.PI_STARTUP_BENCH_RUNS ?? "10", 10);
const warmupCount = Number.parseInt(process.env.PI_STARTUP_BENCH_WARMUPS ?? "2", 10);

if (!Number.isInteger(runCount) || runCount < 1) {
  throw new Error("PI_STARTUP_BENCH_RUNS must be a positive integer");
}
if (!Number.isInteger(warmupCount) || warmupCount < 0) {
  throw new Error("PI_STARTUP_BENCH_WARMUPS must be a non-negative integer");
}

function percentile(values, fraction) {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function runPi(extension) {
  const runRoot = mkdtempSync(join(tmpdir(), "pi-hindsight-startup-"));
  const homeDir = join(runRoot, "home");
  const configDir = join(homeDir, ".pi", "agent");
  const projectDir = join(runRoot, "project");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectDir);
  const args = [
    piCli,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-session",
    "--mode",
    "rpc",
    ...(extension ? ["--extension", extension] : []),
  ];
  const started = process.hrtime.bigint();
  try {
    const result = spawnSync(process.execPath, args, {
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        PI_CODING_AGENT_DIR: configDir,
        PI_OFFLINE: "1",
        USERPROFILE: homeDir,
      },
      input: '{"type":"get_state"}\n{"type":"abort"}\n',
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Pi exited with status ${result.status}`);
    }
    if (!result.stdout.includes('"command":"get_state"')) {
      throw new Error("Pi did not answer the startup readiness probe");
    }
    return Number(process.hrtime.bigint() - started) / 1e6;
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

function benchmark(name, extension) {
  for (let index = 0; index < warmupCount; index += 1) runPi(extension);
  const samplesMs = Array.from({ length: runCount }, () => runPi(extension));
  return {
    name,
    medianMs: median(samplesMs),
    p95Ms: percentile(samplesMs, 0.95),
    minMs: Math.min(...samplesMs),
    maxMs: Math.max(...samplesMs),
    samplesMs,
  };
}

const baseline = benchmark("baseline", undefined);
const hindsight = benchmark("hindsight", extensionPath);
const result = {
  piVersion: spawnSync(
    process.execPath,
    [
      "-p",
      `require(${JSON.stringify(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"))}).version`,
    ],
    { encoding: "utf8" },
  ).stdout.trim(),
  extensionPath,
  runs: runCount,
  warmups: warmupCount,
  baseline,
  hindsight,
  addedMedianMs: hindsight.medianMs - baseline.medianMs,
};

console.log(JSON.stringify(result, null, 2));
