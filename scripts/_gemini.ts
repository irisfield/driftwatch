import { fetchWithRetry } from "./_retry.ts";

interface GeminiGenerateContentResponse {
  candidates: { content: { parts: { text: string }[] } }[];
}

function isGeminiResponse(value: unknown): value is GeminiGenerateContentResponse {
  if (typeof value !== "object" || value === null || !("candidates" in value)) return false;
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) return false;
  const first: unknown = value.candidates[0];
  if (typeof first !== "object" || first === null || !("content" in first)) return false;
  const content = first.content;
  if (typeof content !== "object" || content === null || !("parts" in content)) return false;
  if (!Array.isArray(content.parts) || content.parts.length === 0) return false;
  const part: unknown = content.parts[0];
  return (
    typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
  );
}

export async function callGeminiChatCompletion(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini chat completions API error ${String(response.status)}: ${body}`);
  }
  const json: unknown = await response.json();
  if (!isGeminiResponse(json)) {
    throw new Error("Gemini chat completions API: unexpected response shape");
  }
  const candidate = json.candidates[0];
  if (candidate === undefined) {
    throw new Error("Gemini chat completions API: no candidates in response");
  }
  const part = candidate.content.parts[0];
  if (part === undefined) {
    throw new Error("Gemini chat completions API: no content parts in response");
  }
  return part.text.trim();
}
