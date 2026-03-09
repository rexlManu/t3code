import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const CodexProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  homePath: Schema.optional(TrimmedNonEmptyString),
  spoofAsCodexDesktop: Schema.optional(Schema.Boolean),
});

export const OpencodeProviderStartOptions = Schema.Struct({
  serverUrl: Schema.optional(TrimmedNonEmptyString),
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  hostname: Schema.optional(TrimmedNonEmptyString),
  port: Schema.optional(Schema.Number),
  workspace: Schema.optional(TrimmedNonEmptyString),
  username: Schema.optional(TrimmedNonEmptyString),
  password: Schema.optional(TrimmedNonEmptyString),
});

export const CopilotProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  configDir: Schema.optional(TrimmedNonEmptyString),
});

export const ClaudeCodeProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  permissionMode: Schema.optional(TrimmedNonEmptyString),
  maxThinkingTokens: Schema.optional(Schema.Int),
});

export const CursorProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
});

export const GeminiProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
});

export const ProviderStartOptions = Schema.Struct({
  codex: Schema.optional(CodexProviderStartOptions),
  opencode: Schema.optional(OpencodeProviderStartOptions),
  copilot: Schema.optional(CopilotProviderStartOptions),
  claudeCode: Schema.optional(ClaudeCodeProviderStartOptions),
  cursor: Schema.optional(CursorProviderStartOptions),
  gemini: Schema.optional(GeminiProviderStartOptions),
});
export type ProviderStartOptions = typeof ProviderStartOptions.Type;
