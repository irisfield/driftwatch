import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { validateGoldenDataset, type GoldenEntry } from "../packages/eval-core/src/golden-schema.ts";
import { fetchCorpusFingerprint } from "./_fingerprint.ts";
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

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  content: string;
}

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const samples = parseInt(args["samples"] ?? "50", 10);
const output = args["output"] ?? `golden/${corpus}.json`;

const openaiKey = requireEnv("OPENAI_API_KEY");
const databaseUrl = requireEnv("DATABASE_URL");
const bootstrapModel = process.env["BOOTSTRAP_MODEL"] ?? "gpt-4o-mini";

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

try {
  const fingerprint = await fetchCorpusFingerprint(pool, corpus);

  const { rows } = await pool.query<ChunkRow>(
    `SELECT c.id AS chunk_id, c.document_id, c.content
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE d.corpus = $1
     ORDER BY random()
     LIMIT $2`,
    [corpus, samples],
  );

  console.log(
    `Generating questions for ${String(rows.length)} chunks from corpus "${corpus}"...`,
  );

  const entries: GoldenEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    process.stdout.write(
      `  [${String(i + 1)}/${String(rows.length)}] chunk ${row.chunk_id}...`,
    );
    const prompt =
      "Given this documentation excerpt, write one specific question that this excerpt " +
      "directly and completely answers. Paraphrase — do not copy the excerpt's vocabulary " +
      "into the question. Output only the question, no explanation.\n\nExcerpt:\n" +
      row.content;
    const question = await callChatCompletion(openaiKey, bootstrapModel, prompt);
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
  console.log(
    "Note: all pairs are synthetic. Run calibration before using assert-no-regression:",
  );
  console.log(`  bun run scripts/calibrate-thresholds.ts --corpus ${corpus}`);
} finally {
  await pool.end();
}
