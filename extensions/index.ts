import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./tui/commands.js";
import { createMemoryLifecycle } from "./lifecycle/memory-lifecycle.js";
import { createOperationCatalog } from "./operations/operation-catalog.js";
import { registerTools } from "./operations/tools.js";

export default function hindsightExtension(pi: ExtensionAPI) {
  let sessionId: string | undefined;
  const lifecycle = createMemoryLifecycle(process.cwd(), (event) => {
    pi.events.emit("hindsight:retrieval", { ...event, ...(sessionId ? { sessionId } : {}) });
  });
  const catalog = createOperationCatalog(lifecycle.deps);

  registerTools(pi, catalog);
  registerCommands(pi, catalog);

  pi.on("session_start", async (_event, ctx) => {
    try {
      sessionId = ctx.sessionManager.getSessionId();
    } catch {
      sessionId = undefined;
    }
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
