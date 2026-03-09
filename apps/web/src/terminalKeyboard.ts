import type { ShortcutEventLike } from "./keybindings";
import { isMacPlatform } from "./lib/utils";

function normalizeKey(key: string): string {
  return key.toLowerCase();
}

export function isTerminalSelectionCopyShortcut(
  event: ShortcutEventLike,
  {
    hasSelection,
    platform = typeof navigator === "undefined" ? "" : navigator.platform,
  }: {
    hasSelection: boolean;
    platform?: string;
  },
): boolean {
  if (!hasSelection || normalizeKey(event.key) !== "c") {
    return false;
  }

  if (isMacPlatform(platform)) {
    return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  }

  if (event.metaKey || event.altKey) {
    return false;
  }

  return event.ctrlKey;
}
