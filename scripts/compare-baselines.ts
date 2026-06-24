/**
 * Compare two evaluation reports and print a metric delta table.
 *
 * Usage:
 *   bun run scripts/compare-baselines.ts --before golden/supabase-baseline.json \
 *     --after golden/supabase-baseline-v2.json
 *
 * Typical use: embedding-model swap study. Run run-eval.ts twice (once per model,
 * each time after ingesting the corpus with that model), then pass the two output
 * files here to quantify the retrieval impact.
 */

import { readFile } from "node:fs/promises";

import { compareReports } from "../packages/eval-core/src/compare.ts";
import type { RetrievalReport } from "../packages/eval-core/src/evaluate.ts";

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

function fmt(n: number): string {
  return n.toFixed(4);
}

function arrow(delta: number): string {
  if (delta > 0.001) return "+";
  if (delta < -0.001) return "-";
  return " ";
}

const args = parseArgs(process.argv.slice(2));
const beforePath = args["before"];
const afterPath = args["after"];

if (!beforePath || !afterPath) {
  console.error("Usage: compare-baselines.ts --before <path> --after <path>");
  process.exit(1);
}

const before = JSON.parse(await readFile(beforePath, "utf8")) as RetrievalReport;
const after = JSON.parse(await readFile(afterPath, "utf8")) as RetrievalReport;

const delta = compareReports(before, after);

const beforeModel = before.fingerprint?.embeddingModel ?? "(unknown)";
const afterModel = after.fingerprint?.embeddingModel ?? "(unknown)";

console.log("");
console.log("Embedding model comparison");
console.log(`  before: ${beforeModel}`);
console.log(`  after:  ${afterModel}`);
console.log(`  k:      ${String(delta.k)}`);
console.log("");

if (delta.fingerprint.embeddingModelChanged) {
  console.log("  (embedding model changed — comparing across models as intended)");
} else if (delta.fingerprint.comparable) {
  console.log("  (same embedding model — this is a within-model regression check, not a swap study)");
} else {
  console.log("  (fingerprint missing from one or both reports — model comparison is best-effort)");
}

console.log("");
console.log("Metric          Before     After      Delta");
console.log("----------      ------     -----      -----");

const rows: [string, number, number, number][] = [
  ["recallAtK", delta.recallAtK.before, delta.recallAtK.after, delta.recallAtK.delta],
  ["hitRate", delta.hitRate.before, delta.hitRate.after, delta.hitRate.delta],
  ["mrr", delta.mrr.before, delta.mrr.after, delta.mrr.delta],
  ["ndcgAtK", delta.ndcgAtK.before, delta.ndcgAtK.after, delta.ndcgAtK.delta],
  ["precisionAtK", delta.precisionAtK.before, delta.precisionAtK.after, delta.precisionAtK.delta],
];

for (const [name, b, a, d] of rows) {
  const sign = arrow(d);
  const flag = d < -0.05 ? " !!!" : d < -0.01 ? " !" : "";
  console.log(
    `${name.padEnd(16)}${fmt(b).padEnd(11)}${fmt(a).padEnd(11)}${sign}${fmt(Math.abs(d))}${flag}`,
  );
}

console.log("");

const regressions = rows.filter(([, , , d]) => d < -0.001).map(([name]) => name);
const improvements = rows.filter(([, , , d]) => d > 0.001).map(([name]) => name);

if (regressions.length > 0) {
  console.log(`Regressed: ${regressions.join(", ")}`);
}
if (improvements.length > 0) {
  console.log(`Improved:  ${improvements.join(", ")}`);
}
if (regressions.length === 0 && improvements.length === 0) {
  console.log("No material difference between models.");
}
console.log("");
