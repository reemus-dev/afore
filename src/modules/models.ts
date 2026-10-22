import type {Model} from "@anthropic-ai/sdk/resources/messages/messages";

const ALIASES: Record<string, Model> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** Resolve a model alias or pass through a full model ID */
export function resolveModel(input: string): Model {
  return ALIASES[input] ?? input;
}
