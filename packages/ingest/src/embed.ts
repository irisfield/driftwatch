import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface EmbedderApiKeys {
  openaiApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
}

const OPENAI_BATCH_SIZE = 96;

// The Gemini free tier quota (embed_content_free_tier_requests) is 100
// EmbedContent-equivalent requests per minute per project per model, and each
// item in a batchEmbedContents call counts individually toward that limit. A
// batch of 100 would consume the entire window in one call, leaving the next
// batch with zero quota and forcing it to wait out a full extra minute.
const GEMINI_BATCH_SIZE = 50;

// Retry on 429 with the delay Gemini reports in the error body's
// details[].retryDelay (e.g. "46s") rather than failing the whole ingest run.
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

// Matches the halfvec(1536) column in supabase/migrations. Both gemini-embedding-001
// and gemini-embedding-2 support truncating their native 3072-dim output to 1536 via
// output_dimensionality.
export const GEMINI_OUTPUT_DIMENSIONS = 1536;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

function isOpenAIResponse(value: unknown): value is OpenAIEmbeddingResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  return Array.isArray(value.data);
}

interface GeminiBatchEmbedResponse {
  embeddings: { values: number[] }[];
}

function isGeminiBatchEmbedResponse(value: unknown): value is GeminiBatchEmbedResponse {
  if (typeof value !== "object" || value === null || !("embeddings" in value)) return false;
  if (!Array.isArray(value.embeddings)) return false;
  return value.embeddings.every(
    (e: unknown) =>
      typeof e === "object" &&
      e !== null &&
      "values" in e &&
      Array.isArray(e.values) &&
      e.values.every((v: unknown): v is number => typeof v === "number"),
  );
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((x): x is number => typeof x === "number");
}

// gemini-embedding-001 does not normalize MRL-truncated output to unit length;
// gemini-embedding-2 does. Normalizing unconditionally is a correct no-op for
// already-unit vectors and keeps both models consistent for halfvec_cosine_ops.
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function createOpenAIEmbedder(apiKey: string, model: string): EmbedFn {
  return async (texts: string[]): Promise<number[][]> => {
    const results: (number[] | undefined)[] = Array.from({ length: texts.length });

    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: batch, model }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI embeddings API error ${String(response.status)}: ${body}`);
      }

      const json: unknown = await response.json();
      if (!isOpenAIResponse(json)) {
        throw new Error("OpenAI embeddings API: unexpected response shape");
      }

      for (const item of json.data) {
        results[i + item.index] = item.embedding;
      }
    }

    return results.map((r, idx) => {
      if (r === undefined) {
        throw new Error(`OpenAI embeddings API: missing result for index ${String(idx)}`);
      }
      return r;
    });
  };
}

export function createGeminiEmbedder(apiKey: string, model: string): EmbedFn {
  return async (texts: string[]): Promise<number[][]> => {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += GEMINI_BATCH_SIZE) {
      const batch = texts.slice(i, i + GEMINI_BATCH_SIZE);
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
              outputDimensionality: GEMINI_OUTPUT_DIMENSIONS,
            })),
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini embeddings API error ${String(response.status)}: ${body}`);
      }

      const json: unknown = await response.json();
      if (!isGeminiBatchEmbedResponse(json)) {
        throw new Error("Gemini embeddings API: unexpected response shape");
      }
      if (json.embeddings.length !== batch.length) {
        throw new Error(
          `Gemini embeddings API: expected ${String(batch.length)} embeddings, got ${String(json.embeddings.length)}`,
        );
      }

      for (const item of json.embeddings) {
        results.push(normalize(item.values));
      }
    }

    return results;
  };
}

// Selects a provider by model name: "gemini-*" models use the Gemini API,
// everything else is treated as an OpenAI embedding model.
export function createEmbedder(model: string, apiKeys: EmbedderApiKeys): EmbedFn {
  if (model.startsWith("gemini-")) {
    if (apiKeys.geminiApiKey === undefined) {
      throw new Error(`GEMINI_API_KEY is required for embedding model "${model}"`);
    }
    return createGeminiEmbedder(apiKeys.geminiApiKey, model);
  }
  if (apiKeys.openaiApiKey === undefined) {
    throw new Error(`OPENAI_API_KEY is required for embedding model "${model}"`);
  }
  return createOpenAIEmbedder(apiKeys.openaiApiKey, model);
}

interface CacheMiss {
  textIndex: number;
  hash: string;
}

export function createCachedEmbedder(embed: EmbedFn, cacheDir: string): EmbedFn {
  const resolvedDir = path.resolve(cacheDir);

  return async (texts: string[]): Promise<number[][]> => {
    const hashes = texts.map((t) => createHash("sha256").update(t).digest("hex"));
    const results: (number[] | undefined)[] = Array.from({ length: texts.length });
    const misses: CacheMiss[] = [];

    // Read all cache files in parallel — they are fully independent.
    const cacheReadResults = await Promise.all(
      hashes.map(async (hash, i) => {
        const filePath = path.join(resolvedDir, `${hash}.json`);
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed: unknown = JSON.parse(raw);
          if (isNumberArray(parsed)) {
            return { hit: true as const, index: i, embedding: parsed };
          }
          return { hit: false as const, index: i, hash };
        } catch {
          return { hit: false as const, index: i, hash };
        }
      }),
    );

    for (const entry of cacheReadResults) {
      if (entry.hit) {
        results[entry.index] = entry.embedding;
      } else {
        misses.push({ textIndex: entry.index, hash: entry.hash });
      }
    }

    if (misses.length > 0) {
      await mkdir(resolvedDir, { recursive: true });
      // Process and cache one Gemini batch at a time so a mid-run 429 preserves
      // progress: completed batches are on disk, next retry skips them as cache hits.
      for (let i = 0; i < misses.length; i += GEMINI_BATCH_SIZE) {
        const batch = misses.slice(i, i + GEMINI_BATCH_SIZE);
        const batchTexts = batch.map(({ textIndex }) => texts[textIndex] ?? "");
        const embeddings = await embed(batchTexts);
        for (const [j, { textIndex, hash }] of batch.entries()) {
          const embedding = embeddings[j];
          results[textIndex] = embedding;
          await writeFile(
            path.join(resolvedDir, `${hash}.json`),
            JSON.stringify(embedding),
            "utf8",
          );
        }
      }
    }

    return results.map((r, idx) => {
      if (r === undefined) {
        throw new Error(`createCachedEmbedder: missing result for index ${String(idx)}`);
      }
      return r;
    });
  };
}
