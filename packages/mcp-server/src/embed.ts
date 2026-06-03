export type QueryEmbedFn = (text: string) => Promise<number[]>;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

function isOpenAIResponse(value: unknown): value is OpenAIEmbeddingResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  return Array.isArray(value.data);
}

export function createQueryEmbedder(apiKey: string, model: string): QueryEmbedFn {
  return async (text: string): Promise<number[]> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: text, model }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings API error ${String(response.status)}: ${body}`);
    }

    const json: unknown = await response.json();
    if (!isOpenAIResponse(json)) {
      throw new Error("OpenAI embeddings API: unexpected response shape");
    }

    const item = json.data[0];
    if (item === undefined) {
      throw new Error("OpenAI embeddings API: no embedding in response");
    }
    return item.embedding;
  };
}
