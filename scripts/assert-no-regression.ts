import { readFile, writeFile } from "node:fs/promises";

import pg from "pg";

import {
  assertNoRegression,
  assertPerQueryFloors,
  DriftGateError,
} from "../packages/eval-core/src/assert.ts";
import type { CalibratedThresholds } from "../packages/eval-core/src/calibrate-thresholds.ts";
import { compareReports } from "../packages/eval-core/src/compare.ts";
import { evaluateRetrieval, type RetrievalReport } from "../packages/eval-core/src/evaluate.ts";
import { loadGoldenDataset } from "../packages/eval-core/src/golden-schema.ts";
import { createCachedEmbedder, createOpenAIEmbedder } from "../packages/ingest/src/embed.ts";
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

function fmt(n: number): string {
  if (Number.isNaN(n)) return "  N/A ";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(4)}`;
}

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const k = parseInt(args["k"] ?? "5", 10);

const baselinePath = `golden/${corpus}-baseline.json`;
const thresholdsPath = "golden/thresholds.json";
const currentPath = `golden/${corpus}-current.json`;

const openaiKey = requireEnv("OPENAI_API_KEY");
const databaseUrl = requireEnv("DATABASE_URL");
const embeddingModel = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small";

// Load baseline — throw with actionable message if absent
let baselineRaw: string;
try {
  baselineRaw = await readFile(baselinePath, "utf8");
} catch (error) {
  if (error instanceof Error) {
    throw new Error(
      `No baseline found at ${baselinePath}.\n` +
        `Run: bun run scripts/run-eval.ts --output ${baselinePath}`,
    );
  }
  throw error;
}
const baseline: RetrievalReport = JSON.parse(baselineRaw);

// Load thresholds
let thresholdsRaw: string;
try {
  thresholdsRaw = await readFile(thresholdsPath, "utf8");
} catch (error) {
  if (error instanceof Error) {
    throw new Error(
      `No thresholds found at ${thresholdsPath}.\n` +
        `Run: bun run scripts/calibrate-thresholds.ts --corpus ${corpus}`,
    );
  }
  throw error;
}
const thresholdsFile: Record<string, CalibratedThresholds> = JSON.parse(thresholdsRaw);
const thresholds = thresholdsFile[corpus];
if (thresholds === undefined) {
  throw new Error(
    `No thresholds for corpus "${corpus}" in ${thresholdsPath}.\n` +
      `Run: bun run scripts/calibrate-thresholds.ts --corpus ${corpus}`,
  );
}

const golden = await loadGoldenDataset(`golden/${corpus}.json`);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

try {
  const fingerprint = await fetchCorpusFingerprint(pool, corpus);
  const embedder = createCachedEmbedder(
    createOpenAIEmbedder(openaiKey, embeddingModel),
    ".driftwatch-cache/embeddings",
  );
  const retrieve = makeRetrieveFn(embedder, pool, corpus, k);

  console.log(`Running retrieval: corpus="${corpus}", k=${String(k)}...`);
  const current = await evaluateRetrieval({ golden, retrieve, k, fingerprint });

  await writeFile(currentPath, JSON.stringify(current, null, 2), "utf8");

  const delta = compareReports(baseline, current);

  let passed = true;
  try {
    assertNoRegression(delta, thresholds.regression);
    assertPerQueryFloors(delta, thresholds.perQueryFloors);
  } catch (error) {
    if (error instanceof DriftGateError) {
      console.error(`[${error.kind}] ${error.message}`);
      if (
        error.kind === "corpus-changed" &&
        baseline.fingerprint !== undefined &&
        current.fingerprint !== undefined
      ) {
        console.error(
          `  corpus hash: ${baseline.fingerprint.corpusHash.slice(0, 8)}... → ${current.fingerprint.corpusHash.slice(0, 8)}...`,
        );
        console.error(
          `  Action: run scripts/run-eval.ts --output ${baselinePath} to regenerate.`,
        );
      }
      process.exitCode = 1;
      passed = false;
    } else {
      throw error;
    }
  }

  if (passed) {
    const synthCount = delta.queries.filter((q) => q.source === "synthetic").length;
    const userCount = delta.queries.filter((q) => q.source === "user").length;
    const synthFraction =
      delta.queries.length > 0
        ? ((synthCount / delta.queries.length) * 100).toFixed(0)
        : "0";

    console.log("");
    console.log("PASS");
    console.log(`  corpus: ${corpus}  k: ${String(k)}`);
    console.log(
      `  queries: ${String(delta.queries.length)} (${String(userCount)} user, ${String(synthCount)} synthetic, ${synthFraction}% synthetic)`,
    );
    console.log("");
    console.log("  metric       before    after     delta");
    console.log("  -----------  --------  --------  --------");
    console.log(
      `  recallAtK    ${delta.recallAtK.before.toFixed(4)}    ${delta.recallAtK.after.toFixed(4)}    ${fmt(delta.recallAtK.delta)}`,
    );
    console.log(
      `  hitRate      ${delta.hitRate.before.toFixed(4)}    ${delta.hitRate.after.toFixed(4)}    ${fmt(delta.hitRate.delta)}`,
    );
    console.log(
      `  mrr          ${delta.mrr.before.toFixed(4)}    ${delta.mrr.after.toFixed(4)}    ${fmt(delta.mrr.delta)}`,
    );
    console.log(
      `  ndcgAtK      ${delta.ndcgAtK.before.toFixed(4)}    ${delta.ndcgAtK.after.toFixed(4)}    ${fmt(delta.ndcgAtK.delta)}`,
    );
    console.log("");
    console.log(`  current report written to: ${currentPath}`);
  }
} finally {
  await pool.end();
}
