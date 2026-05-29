import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const OPENAI_BATCH_SIZE = 96;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

function isOpenAIResponse(value: unknown): value is OpenAIEmbeddingResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  return Array.isArray(value.data);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((x): x is number => typeof x === "number");
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

    for (const [i, hash] of hashes.entries()) {
      const filePath = path.join(resolvedDir, `${hash}.json`);
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (isNumberArray(parsed)) {
          results[i] = parsed;
        } else {
          misses.push({ textIndex: i, hash });
        }
      } catch {
        misses.push({ textIndex: i, hash });
      }
    }

    if (misses.length > 0) {
      const missTexts = misses.map(({ textIndex }) => texts[textIndex] ?? "");
      const embeddings = await embed(missTexts);
      await mkdir(resolvedDir, { recursive: true });

      for (const [j, { textIndex, hash }] of misses.entries()) {
        const embedding = embeddings[j];
        results[textIndex] = embedding;
        const filePath = path.join(resolvedDir, `${hash}.json`);
        await writeFile(filePath, JSON.stringify(embedding), "utf8");
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
