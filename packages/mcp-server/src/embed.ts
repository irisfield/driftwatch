export type QueryEmbedFn = (text: string) => Promise<number[]>;

export interface EmbedderApiKeys {
  openaiApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
}

// Matches the halfvec(1536) column in supabase/migrations. Both gemini-embedding-001
// and gemini-embedding-2 support truncating their native 3072-dim output to 1536 via
// output_dimensionality.
const GEMINI_OUTPUT_DIMENSIONS = 1536;

// The Gemini free tier quota (embed_content_free_tier_requests) is 100 requests
// per minute per project per model. Retry on 429 with the delay Gemini reports
// in the error body's details[].retryDelay (e.g. "46s") rather than failing
// the query.
const GEMINI_MAX_RETRIES = 5;
const GEMINI_RETRY_BASE_MS = 2000;
const GEMINI_RETRY_SAFETY_MARGIN_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini reports rate-limit backoff as details[].retryDelay (e.g. "46s") in the
// JSON error body, not via an HTTP Retry-After header.
function parseRetryDelayMs(body: string): number | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || !("error" in json)) return undefined;
  const error: unknown = json.error;
  if (typeof error !== "object" || error === null || !("details" in error)) return undefined;
  const details: unknown = error.details;
  if (!Array.isArray(details)) return undefined;

  const detail = details.find(
    (d: unknown): d is { retryDelay: string } =>
      typeof d === "object" && d !== null && "retryDelay" in d && typeof d.retryDelay === "string",
  );
  if (detail === undefined) return undefined;

  const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
  if (match === null) return undefined;
  const secondsStr = match[1];
  if (secondsStr === undefined) return undefined;
  const seconds = Number(secondsStr);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= GEMINI_MAX_RETRIES) {
      return response;
    }
    const body = await response.text();
    const reportedDelayMs = parseRetryDelayMs(body);
    const delayMs =
      reportedDelayMs === undefined
        ? GEMINI_RETRY_BASE_MS * 2 ** attempt
        : reportedDelayMs + GEMINI_RETRY_SAFETY_MARGIN_MS;
    await sleep(delayMs);
  }
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

function isOpenAIResponse(value: unknown): value is OpenAIEmbeddingResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  return Array.isArray(value.data);
}

interface GeminiEmbedResponse {
  embedding: { values: number[] };
}

function isGeminiEmbedResponse(value: unknown): value is GeminiEmbedResponse {
  if (typeof value !== "object" || value === null || !("embedding" in value)) return false;
  const embedding: unknown = value.embedding;
  if (typeof embedding !== "object" || embedding === null || !("values" in embedding)) {
    return false;
  }
  return (
    Array.isArray(embedding.values) &&
    embedding.values.every((v: unknown): v is number => typeof v === "number")
  );
}

// gemini-embedding-001 does not normalize MRL-truncated output to unit length;
// gemini-embedding-2 does. Normalizing unconditionally is a correct no-op for
// already-unit vectors and keeps both models consistent for halfvec_cosine_ops.
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function createOpenAIQueryEmbedder(apiKey: string, model: string): QueryEmbedFn {
  return async (text: string): Promise<number[]> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

export function createGeminiQueryEmbedder(apiKey: string, model: string): QueryEmbedFn {
  return async (text: string): Promise<number[]> => {
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: GEMINI_OUTPUT_DIMENSIONS,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini embeddings API error ${String(response.status)}: ${body}`);
    }

    const json: unknown = await response.json();
    if (!isGeminiEmbedResponse(json)) {
      throw new Error("Gemini embeddings API: unexpected response shape");
    }
    return normalize(json.embedding.values);
  };
}

// Selects a provider by model name: "gemini-*" models use the Gemini API,
// everything else is treated as an OpenAI embedding model.
export function createQueryEmbedder(model: string, apiKeys: EmbedderApiKeys): QueryEmbedFn {
  if (model.startsWith("gemini-")) {
    if (apiKeys.geminiApiKey === undefined) {
      throw new Error(`GEMINI_API_KEY is required for embedding model "${model}"`);
    }
    return createGeminiQueryEmbedder(apiKeys.geminiApiKey, model);
  }
  if (apiKeys.openaiApiKey === undefined) {
    throw new Error(`OPENAI_API_KEY is required for embedding model "${model}"`);
  }
  return createOpenAIQueryEmbedder(apiKeys.openaiApiKey, model);
}
