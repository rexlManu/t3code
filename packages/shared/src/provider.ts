import type { ProviderKind } from "@t3tools/contracts";

export const PROVIDER_ORDER = [
  "codex",
  "opencode",
  "copilot",
  "claudeCode",
  "cursor",
  "gemini",
] as const satisfies ReadonlyArray<ProviderKind>;

export const PROVIDER_LABELS = {
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  claudeCode: "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini",
} as const satisfies Record<ProviderKind, string>;

export function getProviderLabel(provider: ProviderKind): string {
  return PROVIDER_LABELS[provider];
}
