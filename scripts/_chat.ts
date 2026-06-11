import { callGeminiChatCompletion } from "./_gemini.ts";
import { callOpenAIChatCompletion } from "./_openai.ts";

export interface ChatApiKeys {
  openaiApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
}

// Selects a provider by model name: "gemini-*" models use the Gemini API,
// everything else is treated as an OpenAI chat completion model.
export function callChatCompletion(
  model: string,
  prompt: string,
  apiKeys: ChatApiKeys,
): Promise<string> {
  if (model.startsWith("gemini-")) {
    if (apiKeys.geminiApiKey === undefined) {
      throw new Error(`GEMINI_API_KEY is required for chat model "${model}"`);
    }
    return callGeminiChatCompletion(apiKeys.geminiApiKey, model, prompt);
  }
  if (apiKeys.openaiApiKey === undefined) {
    throw new Error(`OPENAI_API_KEY is required for chat model "${model}"`);
  }
  return callOpenAIChatCompletion(apiKeys.openaiApiKey, model, prompt);
}
