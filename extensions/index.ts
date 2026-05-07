import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools.js";
import { registerCommands } from "./commands.js";
import { createMemoryLifecycle } from "./memory-lifecycle.js";

export default function hindsightExtension(pi: ExtensionAPI) {
  const lifecycle = createMemoryLifecycle(process.cwd());

  registerTools(pi, lifecycle.deps);
  registerCommands(pi, lifecycle.deps);

  pi.on("session_start", async (_event, ctx) => {
    await lifecycle.initialize(ctx);
  });

  pi.on("context", async (event, ctx) => lifecycle.recall(event, ctx));

  pi.on("agent_end", async (event, ctx) => {
    await lifecycle.retain(event, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await lifecycle.shutdown(ctx);
  });
}
