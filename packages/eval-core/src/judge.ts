import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface JudgeChunk {
  id: string;
  content: string;
}

export interface JudgeResult {
  id: string;
  relevant: boolean;
  score: number;
  reason: string;
}

export interface JudgeOptions {
  query: string;
  chunks: JudgeChunk[];
  model: string;
  rubric: string;
  rubricVersion: string;
  callModel: (prompt: string) => Promise<string>;
  cacheDir?: string;
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function buildPrompt(query: string, content: string, rubric: string): string {
  return `You are a retrieval relevance judge.

Query: ${query}

Chunk:
${content}

Rubric: ${rubric}

Respond with JSON only — no markdown, no text outside the JSON object:
{"relevant": boolean, "score": number, "reason": "one sentence"}

score must be between 0.0 and 1.0.`;
}

function stripFences(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  if (fenced !== null) {
    return fenced[1]?.trim() ?? raw.trim();
  }
  return raw.trim();
}

function toJudgeResult(value: unknown): JudgeResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (!("id" in value) || !("relevant" in value) || !("score" in value) || !("reason" in value)) {
    return undefined;
  }
  const { id, relevant, score, reason } = value;
  if (typeof id !== "string") return undefined;
  if (typeof relevant !== "boolean") return undefined;
  if (typeof score !== "number" || score < 0 || score > 1) return undefined;
  if (typeof reason !== "string") return undefined;
  return { id, relevant, score, reason };
}

function parseJudgeResponse(raw: string, id: string): JudgeResult {
  const cleaned = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new TypeError(
      `judgeRelevance: invalid JSON response for chunk "${id}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError(`judgeRelevance: response for chunk "${id}" must be a JSON object`);
  }

  if (!("relevant" in parsed) || !("score" in parsed) || !("reason" in parsed)) {
    throw new TypeError(
      `judgeRelevance: response for chunk "${id}" is missing required fields (relevant, score, reason)`,
    );
  }

  const { relevant, score, reason } = parsed;

  if (typeof relevant !== "boolean") {
    throw new TypeError(
      `judgeRelevance: "relevant" for chunk "${id}" must be boolean, got ${typeof relevant}`,
    );
  }
  if (typeof score !== "number" || score < 0 || score > 1) {
    throw new TypeError(
      `judgeRelevance: "score" for chunk "${id}" must be a number in [0, 1], got ${String(score)}`,
    );
  }
  if (typeof reason !== "string") {
    throw new TypeError(
      `judgeRelevance: "reason" for chunk "${id}" must be a string, got ${typeof reason}`,
    );
  }

  return { id, relevant, score, reason };
}

async function readCache(filePath: string): Promise<JudgeResult | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return toJudgeResult(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function judgeChunk(
  chunk: JudgeChunk,
  query: string,
  rubric: string,
  rubricVersion: string,
  model: string,
  callModel: (prompt: string) => Promise<string>,
  cacheDir: string,
): Promise<JudgeResult> {
  const contentHash = sha256hex(chunk.content);
  const cacheKey = sha256hex(JSON.stringify({ query, contentHash, model, rubricVersion }));
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

  const cached = await readCache(cacheFile);
  if (cached !== undefined) {
    return { ...cached, id: chunk.id };
  }

  const prompt = buildPrompt(query, chunk.content, rubric);
  const raw = await callModel(prompt);
  const result = parseJudgeResponse(raw, chunk.id);

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(result), "utf8");

  return result;
}

export async function judgeRelevance(options: JudgeOptions): Promise<JudgeResult[]> {
  const {
    query,
    chunks,
    model,
    rubric,
    rubricVersion,
    callModel,
    cacheDir = ".driftwatch-cache/judge",
  } = options;

  if (chunks.length === 0) {
    return [];
  }

  return Promise.all(
    chunks.map((chunk) =>
      judgeChunk(chunk, query, rubric, rubricVersion, model, callModel, cacheDir),
    ),
  );
}
