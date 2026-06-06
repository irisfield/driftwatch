import { readFile, writeFile } from "node:fs/promises";

import pg from "pg";

import { judgeRelevance, type JudgeChunk } from "../packages/eval-core/src/judge.ts";
import { loadGoldenDataset, type GoldenEntry } from "../packages/eval-core/src/golden-schema.ts";
import { createCachedEmbedder, createOpenAIEmbedder } from "../packages/ingest/src/embed.ts";
import { RETRIEVAL_SQL } from "../packages/mcp-server/src/retrieval.ts";
import { callChatCompletion } from "./_openai.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === undefined || !key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value !== undefined && !value.startsWith("--")) {
      args[key.slice(2)] = value;
      i++;
    }
  }
  return args;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sampleRandom<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a !== undefined && b !== undefined) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

interface ChunkRow {
  chunk_id: string;
  content: string;
}

interface RubricFile {
  rubric: string;
  rubricVersion: string;
}

function isRubricFile(value: unknown): value is RubricFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "rubric" in value &&
    typeof value.rubric === "string" &&
    "rubricVersion" in value &&
    typeof value.rubricVersion === "string"
  );
}

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const sampleCount = parseInt(args["sample"] ?? "5", 10);
const k = parseInt(args["k"] ?? "5", 10);

const openaiKey = requireEnv("OPENAI_API_KEY");
const judgeApiKey = requireEnv("JUDGE_API_KEY");
const databaseUrl = requireEnv("DATABASE_URL");
const embeddingModel = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small";
const judgeModel = process.env["JUDGE_MODEL"] ?? "gpt-4o-mini";

const golden = await loadGoldenDataset(`golden/${corpus}.json`);
const sampled: GoldenEntry[] = sampleRandom(golden, sampleCount);

const rubricRaw = await readFile("golden/judge-rubric.json", "utf8");
const rubricParsed: unknown = JSON.parse(rubricRaw);
if (!isRubricFile(rubricParsed)) {
  throw new Error(
    'golden/judge-rubric.json must contain { "rubric": string, "rubricVersion": string }',
  );
}
const { rubric, rubricVersion } = rubricParsed;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

try {
  const embedder = createCachedEmbedder(
    createOpenAIEmbedder(openaiKey, embeddingModel),
    ".driftwatch-cache/embeddings",
  );

  async function retrieveChunks(query: string): Promise<JudgeChunk[]> {
    const [embedding] = await embedder([query]);
    if (embedding === undefined) throw new Error("embedder returned no result");

    const client = await pool.connect();
    try {
      await client.query("SET hnsw.ef_search = 100");
      const result = await client.query<ChunkRow>(RETRIEVAL_SQL, [
        JSON.stringify(embedding),
        k,
        corpus,
      ]);
      return result.rows.map((row) => ({ id: row.chunk_id, content: row.content }));
    } finally {
      client.release();
    }
  }

  const callModel = (prompt: string): Promise<string> =>
    callChatCompletion(judgeApiKey, judgeModel, prompt);

  console.log(
    `Running judge: corpus="${corpus}", sample=${String(sampled.length)}, model=${judgeModel}...`,
  );

  const results = [];
  for (const entry of sampled) {
    process.stdout.write(`  "${entry.query.slice(0, 60)}..."...`);
    const chunks = await retrieveChunks(entry.query);
    const judgeResults = await judgeRelevance({
      query: entry.query,
      chunks,
      model: judgeModel,
      rubric,
      rubricVersion,
      callModel,
    });
    const relevantCount = judgeResults.filter((r) => r.relevant).length;
    process.stdout.write(` ${String(relevantCount)}/${String(chunks.length)} relevant\n`);
    results.push({ query: entry.query, source: entry.source, results: judgeResults });
  }

  const outputPath = `golden/${corpus}-judge-report.json`;
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        corpus,
        judgeModel,
        rubricVersion,
        queriesSampled: results.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nJudge report written to: ${outputPath}`);
} finally {
  await pool.end();
}
