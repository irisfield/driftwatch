import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  calibrateThresholds,
  type CalibratedThresholds,
} from "../packages/eval-core/src/calibrate-thresholds.ts";
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

async function readExistingThresholds(
  filePath: string,
): Promise<Record<string, CalibratedThresholds>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: Record<string, CalibratedThresholds> = JSON.parse(raw);
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
const corpus = args["corpus"] ?? "supabase";
const runs = parseInt(args["runs"] ?? "10", 10);
const k = parseInt(args["k"] ?? "5", 10);
const output = args["output"] ?? "golden/thresholds.json";

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
    `Calibrating thresholds: corpus="${corpus}", k=${String(k)}, runs=${String(runs)}...`,
  );

  const reports = [];
  for (let i = 0; i < runs; i++) {
    process.stdout.write(`  Run ${String(i + 1)}/${String(runs)}...`);
    const report = await evaluateRetrieval({ golden, retrieve, k, fingerprint });
    reports.push(report);
    process.stdout.write(
      ` recall=${report.recallAtK.toFixed(4)} hitRate=${report.hitRate.toFixed(4)}\n`,
    );
  }

  const calibrated = calibrateThresholds({ reports });

  const existing = await readExistingThresholds(output);
  existing[corpus] = calibrated;

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(existing, null, 2), "utf8");

  const { stats, regression, perQueryFloors, syntheticFraction } = calibrated;

  console.log("");
  console.log("Calibration complete");
  console.log(
    `  recallAtK  mean=${String(stats.recallAtK?.mean ?? 0)}  stdev=${String(stats.recallAtK?.stdev ?? 0)}  min=${String(stats.recallAtK?.min ?? 0)}  max=${String(stats.recallAtK?.max ?? 0)}`,
  );
  console.log(
    `  hitRate    mean=${String(stats.hitRate?.mean ?? 0)}  stdev=${String(stats.hitRate?.stdev ?? 0)}  min=${String(stats.hitRate?.min ?? 0)}  max=${String(stats.hitRate?.max ?? 0)}`,
  );
  console.log("");
  console.log("Suggested thresholds:");
  console.log(`  maxRecallDrop:    ${String(regression.maxRecallDrop ?? 0.01)}`);
  console.log(`  maxHitRateDrop:   ${String(regression.maxHitRateDrop ?? 0.01)}`);
  console.log(`  perQueryFloors.minHitRate: ${String(perQueryFloors.minHitRate ?? 1)}`);
  console.log("");
  console.log(`  synthetic fraction: ${(syntheticFraction * 100).toFixed(0)}%`);
  if (syntheticFraction > 0.5) {
    console.log(
      "  WARNING: >50% synthetic queries. Thresholds derived from paraphrased queries " +
        "may not represent real user query difficulty.",
    );
  }
  console.log(`  output: ${output}`);
} finally {
  await pool.end();
}
