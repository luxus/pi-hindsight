import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // Not running inside a Git checkout, or Git is unavailable. Package installs should not fail.
}
