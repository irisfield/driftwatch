interface OpenAIChoice {
  message: { content: string };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

function isOpenAIResponse(value: unknown): value is OpenAIResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("choices" in value) || !Array.isArray(value.choices) || value.choices.length === 0)
    return false;
  const first: unknown = value.choices[0];
  if (typeof first !== "object" || first === null) return false;
  if (!("message" in first) || typeof first.message !== "object" || first.message === null)
    return false;
  if (!("content" in first.message) || typeof first.message.content !== "string") return false;
  return true;
}

export async function callChatCompletion(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI chat completions API error ${String(response.status)}: ${body}`,
    );
  }
  const json: unknown = await response.json();
  if (!isOpenAIResponse(json)) {
    throw new Error("OpenAI chat completions API: unexpected response shape");
  }
  return json.choices[0].message.content.trim();
}
