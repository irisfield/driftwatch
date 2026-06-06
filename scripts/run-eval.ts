import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { evaluateRetrieval } from "../packages/eval-core/src/evaluate.ts";
import { loadGoldenDataset } from "../packages/eval-core/src/golden-schema.ts";
import { createCachedEmbedder, createOpenAIEmbedder } from "../packages/ingest/src/embed.ts";
import { assertGoldenNotStale } from "./_db.ts";
import { fetchCorpusFingerprint } from "./_fingerprint.ts";
import { makeRetrieveFn } from "./_retrieve.ts";

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

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const k = parseInt(args["k"] ?? "5", 10);
const output = args["output"] ?? `golden/${corpus}-baseline.json`;

const openaiKey = requireEnv("OPENAI_API_KEY");
const databaseUrl = requireEnv("DATABASE_URL");
const embeddingModel = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small";

const golden = await loadGoldenDataset(`golden/${corpus}.json`);

const goldenIds = [...new Set(golden.flatMap((e) => e.relevant))];
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

try {
  await assertGoldenNotStale(pool, goldenIds);

  const fingerprint = await fetchCorpusFingerprint(pool, corpus);
  const embedder = createCachedEmbedder(
    createOpenAIEmbedder(openaiKey, embeddingModel),
    ".driftwatch-cache/embeddings",
  );
  const retrieve = makeRetrieveFn(embedder, pool, corpus, k);

  console.log(
    `Running evaluation: corpus="${corpus}", k=${String(k)}, queries=${String(golden.length)}...`,
  );
  const report = await evaluateRetrieval({ golden, retrieve, k, fingerprint });

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");

  const synthCount = report.queries.filter((q) => q.source === "synthetic").length;
  const userCount = report.queries.filter((q) => q.source === "user").length;
  const synthFraction =
    report.queries.length > 0 ? (synthCount / report.queries.length).toFixed(2) : "0.00";

  console.log("");
  console.log("Evaluation complete");
  console.log(`  corpus:           ${corpus}`);
  console.log(`  k:                ${String(k)}`);
  console.log(`  corpus hash:      ${fingerprint.corpusHash.slice(0, 8)}...`);
  console.log(`  embedding model:  ${fingerprint.embeddingModel}`);
  console.log(
    `  queries:          ${String(report.queries.length)} (${String(userCount)} user, ${String(synthCount)} synthetic, synthetic fraction: ${synthFraction})`,
  );
  console.log(`  recallAtK:        ${report.recallAtK.toFixed(4)}`);
  console.log(`  mrr:              ${report.mrr.toFixed(4)}`);
  console.log(`  ndcgAtK:          ${report.ndcgAtK.toFixed(4)}`);
  console.log(`  hitRate:          ${report.hitRate.toFixed(4)}`);
  console.log(`  output:           ${output}`);
} finally {
  await pool.end();
}
