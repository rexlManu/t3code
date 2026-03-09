import { describe, expect, it } from "vitest";

import type { ShortcutEventLike } from "./keybindings";
import { isTerminalSelectionCopyShortcut } from "./terminalKeyboard";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "c",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("isTerminalSelectionCopyShortcut", () => {
  it("requires a selection before treating Cmd+C as copy on macOS", () => {
    expect(
      isTerminalSelectionCopyShortcut(event({ metaKey: true }), {
        hasSelection: true,
        platform: "MacIntel",
      }),
    ).toBe(true);
    expect(
      isTerminalSelectionCopyShortcut(event({ metaKey: true }), {
        hasSelection: false,
        platform: "MacIntel",
      }),
    ).toBe(false);
  });

  it("treats Ctrl+C as copy on non-macOS when text is selected", () => {
    expect(
      isTerminalSelectionCopyShortcut(event({ ctrlKey: true }), {
        hasSelection: true,
        platform: "Linux",
      }),
    ).toBe(true);
  });

  it("allows Ctrl+Shift+C for terminals on non-macOS", () => {
    expect(
      isTerminalSelectionCopyShortcut(event({ ctrlKey: true, shiftKey: true }), {
        hasSelection: true,
        platform: "Win32",
      }),
    ).toBe(true);
  });

  it("rejects unrelated modifiers", () => {
    expect(
      isTerminalSelectionCopyShortcut(event({ ctrlKey: true, altKey: true }), {
        hasSelection: true,
        platform: "Linux",
      }),
    ).toBe(false);
    expect(
      isTerminalSelectionCopyShortcut(event({ metaKey: true, shiftKey: true }), {
        hasSelection: true,
        platform: "MacIntel",
      }),
    ).toBe(false);
  });
});
