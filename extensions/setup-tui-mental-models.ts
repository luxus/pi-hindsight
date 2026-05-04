import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operation-service.js";
import {
  mentalModelFromUnknown,
  mentalModelListFromUnknown,
  mentalModelOption,
  mentalModelWebInterfaceHint,
  renderMentalModel,
  renderMentalModelHistory,
} from "./mental-model-presenter.js";
import { CANCEL } from "./setup-tui-types.js";

function bankOptions(deps: MemoryOperationsDeps): string[] {
  const config = deps.getConfig();
  return config.banks.global.enabled ? ["Project", "Global", CANCEL] : ["Project", CANCEL];
}

function bankForChoice(choice: string | undefined): "project" | "global" | undefined {
  if (choice === "Project") return "project";
  if (choice === "Global") return "global";
  return undefined;
}

export async function handleMentalModels(
  ctx: ExtensionCommandContext,
  deps: MemoryOperationsDeps,
): Promise<void> {
  const bankChoice = await ctx.ui.select("Mental model bank", bankOptions(deps));
  const bank = bankForChoice(bankChoice);
  if (!bank) return;

  const operations = createMemoryOperations(deps);
  const webHint = mentalModelWebInterfaceHint(deps.getConfig().hindsight.baseUrl);

  const listed = await operations.listMentalModels({
    bank,
    options: { detail: "metadata", limit: 100 },
  });
  const models = mentalModelListFromUnknown(listed.result);
  if (models.length === 0) {
    ctx.ui.notify(`No ${bankChoice?.toLowerCase()} mental models found.\n${webHint}`, "info");
    return;
  }

  const options = models.map(mentalModelOption).concat(CANCEL);
  const selected = await ctx.ui.select("Mental models", options);
  if (!selected || selected === CANCEL) return;
  const model = models[options.indexOf(selected)];
  if (!model) return;

  const action = await ctx.ui.select(`Mental model ${model.name} (${model.id})`, [
    "View read-only summary",
    "History summary",
    "Web interface hint",
    CANCEL,
  ]);
  if (!action || action === CANCEL) return;

  if (action === "View read-only summary") {
    const full = await operations.getMentalModel({
      bank,
      mentalModelId: model.id,
      options: { detail: "full" },
    });
    ctx.ui.notify(renderMentalModel(mentalModelFromUnknown(full.result) ?? model, webHint), "info");
    return;
  }

  if (action === "History summary") {
    const history = await operations.getMentalModelHistory({ bank, mentalModelId: model.id });
    ctx.ui.notify(renderMentalModelHistory(history.result, webHint), "info");
    return;
  }

  if (action === "Web interface hint") ctx.ui.notify(webHint, "info");
}
