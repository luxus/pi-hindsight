import { describe, expect, it, vi } from "vitest";
import { isPrefillReplacingInput, inputWithPrefill } from "../extensions/tui/prefill-input.js";

describe("prefill input", () => {
  it("treats printable characters as replace keystrokes", () => {
    expect(isPrefillReplacingInput("a")).toBe(true);
    expect(isPrefillReplacingInput("Z")).toBe(true);
    expect(isPrefillReplacingInput("9")).toBe(true);
    expect(isPrefillReplacingInput("-")).toBe(true);
    expect(isPrefillReplacingInput("pi-coding")).toBe(true);
  });

  it("does not replace on control or navigation sequences", () => {
    expect(isPrefillReplacingInput("\n")).toBe(false);
    expect(isPrefillReplacingInput("\x1b")).toBe(false);
    expect(isPrefillReplacingInput("\x7f")).toBe(false);
    expect(isPrefillReplacingInput("\x05")).toBe(false);
    expect(isPrefillReplacingInput("")).toBe(false);
  });

  it("falls back to stock input when prefill is empty", async () => {
    const input = vi.fn().mockResolvedValue("typed");
    const custom = vi.fn();
    const value = await inputWithPrefill({ input, custom }, "Bank ID", "");
    expect(value).toBe("typed");
    expect(input).toHaveBeenCalledWith("Bank ID", "");
    expect(custom).not.toHaveBeenCalled();
  });

  it("falls back to stock input when custom UI is unavailable", async () => {
    const input = vi.fn().mockResolvedValue("pi-coding");
    const value = await inputWithPrefill(
      { input, custom: undefined as never },
      "Bank ID",
      "pi-coding",
    );
    expect(value).toBe("pi-coding");
    expect(input).toHaveBeenCalledWith("Bank ID", "pi-coding");
  });

  it("uses custom prefill dialog when a default is present", async () => {
    const input = vi.fn();
    const custom = vi.fn().mockResolvedValue("pi-coding");
    const value = await inputWithPrefill({ input, custom }, "Bank ID", "pi-coding");
    expect(value).toBe("pi-coding");
    expect(custom).toHaveBeenCalledOnce();
    expect(input).not.toHaveBeenCalled();
  });
});
