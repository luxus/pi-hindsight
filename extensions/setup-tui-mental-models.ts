import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createMemoryOperations, type MemoryOperationsDeps } from "./memory-operation-service.js";
import {
  mentalModelFromUnknown,
  mentalModelListFromUnknown,
  mentalModelOption,
  renderMentalModel,
  renderMentalModelHistory,
  renderMentalModelOperationResult,
} from "./mental-model-presenter.js";
import { CANCEL } from "./setup-tui-types.js";

function bankOptions(deps: MemoryOperationsDeps): string[] {
  const config = deps.getConfig();
  return config.banks.global.enabled ? ["Project", "Global", CANCEL] : ["Project", CANCEL];
}

function bankForChoice(choice: string | undefined): string | undefined {
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
  const listed = await operations.listMentalModels({
    bank,
    options: { detail: "metadata", limit: 100 },
  });
  const models = mentalModelListFromUnknown(listed.result);
  if (models.length === 0) {
    ctx.ui.notify(`No ${bankChoice?.toLowerCase()} mental models found.`, "info");
    return;
  }

  const options = models.map(mentalModelOption).concat(CANCEL);
  const selected = await ctx.ui.select("Mental models", options);
  if (!selected || selected === CANCEL) return;
  const model = models[options.indexOf(selected)];
  if (!model) return;

  const action = await ctx.ui.select(`Mental model ${model.name} (${model.id})`, [
    "View",
    "History",
    "Refresh",
    "Delete",
    CANCEL,
  ]);
  if (!action || action === CANCEL) return;

  if (action === "View") {
    const full = await operations.getMentalModel({
      bank,
      mentalModelId: model.id,
      options: { detail: "full" },
    });
    ctx.ui.notify(renderMentalModel(mentalModelFromUnknown(full.result) ?? model), "info");
    return;
  }

  if (action === "History") {
    const history = await operations.getMentalModelHistory({ bank, mentalModelId: model.id });
    ctx.ui.notify(renderMentalModelHistory(history.result), "info");
    return;
  }

  if (action === "Refresh") {
    const refreshed = await operations.refreshMentalModel({ bank, mentalModelId: model.id });
    ctx.ui.notify(
      `Hindsight mental model refresh queued for ${model.id}; ${renderMentalModelOperationResult(refreshed.result)}`,
      "info",
    );
    return;
  }

  if (action === "Delete") {
    const confirmation = await ctx.ui.input(
      `Type exact mental model ID to delete ${model.name}`,
      "",
    );
    if (confirmation !== model.id) {
      ctx.ui.notify("Mental model delete cancelled; exact ID did not match.", "warning");
      return;
    }
    await operations.deleteMentalModel({ bank, mentalModelId: model.id });
    ctx.ui.notify(`Deleted Hindsight mental model ${model.id}.`, "warning");
  }
}
