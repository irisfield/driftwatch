import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  validateGoldenDataset,
  type GoldenEntry,
} from "../packages/eval-core/src/golden-schema.ts";
import { callChatCompletion } from "./_chat.ts";
import { fetchCorpusFingerprint } from "./_fingerprint.ts";

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

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  content: string;
}

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const samples = parseInt(args["samples"] ?? "50", 10);
const output = args["output"] ?? `golden/${corpus}.json`;

const databaseUrl = requireEnv("DATABASE_URL");
const bootstrapModel = requireEnv("BOOTSTRAP_MODEL");
const openaiApiKey = process.env["OPENAI_API_KEY"];
const geminiApiKey = process.env["GEMINI_API_KEY"];

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

try {
  const fingerprint = await fetchCorpusFingerprint(pool, corpus);

  // One chunk per document, then a random sample of documents. Sampling
  // chunks directly with ORDER BY random() skews toward documents with many
  // chunks (a single long tutorial can dominate the golden set), leaving most
  // of the corpus unrepresented.
  const { rows } = await pool.query<ChunkRow>(
    `SELECT chunk_id, document_id, content
     FROM (
       SELECT c.id AS chunk_id, c.document_id, c.content,
              ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY random()) AS rn
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.corpus = $1
     ) ranked
     WHERE rn = 1
     ORDER BY random()
     LIMIT $2`,
    [corpus, samples],
  );

  console.log(`Generating questions for ${String(rows.length)} chunks from corpus "${corpus}"...`);

  const entries: GoldenEntry[] = [];
  let stoppedEarly = false;
  // ponytail: 3.5 s inter-request delay keeps burst rate ≤ 17 RPM, under the free-tier cap
  const INTER_REQUEST_DELAY_MS = 3500;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await new Promise<void>((resolve) => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
    const row = rows[i];
    if (row === undefined) continue;
    process.stdout.write(`  [${String(i + 1)}/${String(rows.length)}] chunk ${row.chunk_id}...`);
    const prompt =
      "Given this documentation excerpt, write one specific question that a developer " +
      "would type into a documentation search bar, which this excerpt directly and " +
      "completely answers. Name the concept, feature, or task the excerpt covers " +
      'instead of referring to "this snippet", "this code", or "this record". ' +
      "Paraphrase — do not copy the excerpt's vocabulary into the question. Output only " +
      "the question, no explanation.\n\nExcerpt:\n" +
      row.content;
    let question: string;
    try {
      question = await callChatCompletion(bootstrapModel, prompt, { openaiApiKey, geminiApiKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(` failed (${message})\n`);
      stoppedEarly = true;
      break;
    }
    if (question.length === 0) {
      process.stdout.write(" skipped (empty response)\n");
      continue;
    }
    entries.push({ query: question, relevant: [row.document_id], source: "synthetic" });
    process.stdout.write(" done\n");
  }

  validateGoldenDataset(entries);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(entries, null, 2), "utf8");

  console.log(`\nWrote ${String(entries.length)} pairs to ${output}`);
  console.log(`Embedding model: ${fingerprint.embeddingModel}`);
  console.log(`Corpus hash:     ${fingerprint.corpusHash.slice(0, 8)}...`);
  console.log("");
  console.log("Note: all pairs are synthetic. Run calibration before using assert-no-regression:");
  console.log(`  bun run scripts/calibrate-thresholds.ts --corpus ${corpus}`);

  if (stoppedEarly) {
    console.log("");
    console.log(
      `Stopped early after a request error — wrote ${String(entries.length)}/${String(rows.length)} pairs generated so far.`,
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
