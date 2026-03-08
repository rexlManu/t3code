import { Schema } from "effect";
import { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const CopilotModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
});
export type CopilotModelOptions = typeof CopilotModelOptions.Type;

export const OpencodeModelOptions = Schema.Struct({
  providerId: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
});
export type OpencodeModelOptions = typeof OpencodeModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  opencode: Schema.optional(OpencodeModelOptions),
  copilot: Schema.optional(CopilotModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  copilot: [
    { slug: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { slug: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
  ],
  claudeCode: [
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  cursor: [
    { slug: "auto", name: "Auto" },
    { slug: "composer-1.5", name: "Composer 1.5" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark-preview", name: "GPT-5.3 Codex Spark" },
    { slug: "opus-4.6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { slug: "sonnet-4.6-thinking", name: "Claude Sonnet 4.6 (Thinking)" },
    { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  ],
  gemini: [
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { slug: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
  ],
  opencode: [] as readonly ModelOption[],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = ModelOptionsByProvider[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER = {
  codex: "gpt-5.4",
  copilot: "claude-sonnet-4.6",
  claudeCode: "claude-sonnet-4-6",
  cursor: "opus-4.6-thinking",
  gemini: "gemini-2.5-pro",
  opencode: "gpt-5",
} as const satisfies Record<ProviderKind, ModelSlug>;

export const MODEL_SLUG_ALIASES_BY_PROVIDER = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  copilot: {
    sonnet: "claude-sonnet-4.6",
    opus: "claude-opus-4.6",
    haiku: "claude-haiku-4.5",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    gemini: "gemini-3-pro-preview",
  },
  claudeCode: {
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
  },
  cursor: {
    composer: "composer-1.5",
    "gpt-5.3-codex-spark": "gpt-5.3-codex-spark-preview",
    "claude-4.6-opus-thinking": "opus-4.6-thinking",
    "claude-4.6-sonnet-thinking": "sonnet-4.6-thinking",
  },
  gemini: {
    pro: "gemini-2.5-pro",
    flash: "gemini-2.5-flash",
    lite: "gemini-2.5-flash-lite",
    "3-pro": "gemini-3-pro-preview",
  },
  opencode: {},
} as const satisfies Record<ProviderKind, Record<string, ModelSlug>>;

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  copilot: [],
  claudeCode: [],
  cursor: [],
  gemini: [],
  opencode: CODEX_REASONING_EFFORT_OPTIONS,
} as const satisfies Record<ProviderKind, readonly CodexReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  copilot: null,
  claudeCode: null,
  cursor: null,
  gemini: null,
  opencode: null,
} as const satisfies Record<ProviderKind, CodexReasoningEffort | null>;
