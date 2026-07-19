import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, keyHint } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  getKeybindings,
  Input,
  type Component,
} from "@earendil-works/pi-tui";

/**
 * True when the keystroke would insert text into Pi's Input
 * (printable or Kitty CSI-u printable). Used for select-all prefill replace.
 */
export function isPrefillReplacingInput(data: string): boolean {
  if (!data) return false;
  if (decodeKittyPrintable(data) !== undefined) return true;
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}

type PrefillTheme = {
  fg: (name: string, text: string) => string;
};

/**
 * Input dialog with a visible prefill. First printable keystroke replaces the
 * whole prefill (select-all UX). Enter keeps the current value; Esc cancels.
 * Empty prefill falls through to stock `ui.input`.
 */
export async function inputWithPrefill(
  ui: Pick<ExtensionUIContext, "input" | "custom">,
  title: string,
  prefill: string,
): Promise<string | undefined> {
  const initial = prefill;
  // No prefill, or host without custom UI (tests / RPC stubs): stock input.
  if (!initial || typeof ui.custom !== "function") return ui.input(title, initial);

  return ui.custom<string | undefined>((tui, theme, _keybindings, done) =>
    createPrefillInputComponent({
      title,
      prefill: initial,
      theme: theme as PrefillTheme,
      done,
      requestRender: () => tui.requestRender(),
    }),
  );
}

export function createPrefillInputComponent(args: {
  title: string;
  prefill: string;
  theme: PrefillTheme;
  done: (value: string | undefined) => void;
  requestRender: () => void;
}): Component & { handleInput(data: string): void; dispose?(): void } {
  const input = new Input();
  input.setValue(args.prefill);
  // Move cursor to end so the prefill reads as an editable default.
  input.handleInput("\x05");
  let pristine = true;
  const border = new DynamicBorder((s) => args.theme.fg("borderAccent", s));

  return {
    render(width: number): string[] {
      return [
        ...border.render(width),
        "",
        args.theme.fg("accent", args.title),
        "",
        ...input.render(width),
        "",
        `${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}`,
        "",
        ...border.render(width),
      ];
    },
    invalidate() {
      input.invalidate();
      border.invalidate();
    },
    handleInput(data: string) {
      const kb = getKeybindings();
      if (kb.matches(data, "tui.select.confirm") || data === "\n") {
        args.done(input.getValue());
        return;
      }
      if (kb.matches(data, "tui.select.cancel")) {
        args.done(undefined);
        return;
      }
      if (pristine && isPrefillReplacingInput(data)) {
        input.setValue("");
        pristine = false;
      } else if (pristine) {
        pristine = false;
      }
      input.handleInput(data);
      args.requestRender();
    },
  };
}
