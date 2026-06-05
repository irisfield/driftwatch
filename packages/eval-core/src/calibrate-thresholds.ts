import { type PerQueryFloors, type RegressionThresholds } from "./assert.js";
import { type RetrievalReport } from "./evaluate.js";

const Z = 2;
const MINIMUM_DROP = 0.01;

export interface CalibrationInput {
  reports: RetrievalReport[];
}

export interface CalibrationStats {
  mean: number;
  stdev: number;
  min: number;
  max: number;
  runs: number;
}

export interface CalibratedThresholds {
  regression: RegressionThresholds;
  perQueryFloors: PerQueryFloors;
  stats: Record<string, CalibrationStats>;
  syntheticFraction: number;
  runsUsed: number;
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeStdev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function statsFor(values: number[]): CalibrationStats {
  if (values.length === 0) {
    return { mean: 0, stdev: 0, min: 0, max: 0, runs: 0 };
  }
  const mean = computeMean(values);
  const stdev = computeStdev(values, mean);
  return {
    mean: round4(mean),
    stdev: round4(stdev),
    min: round4(Math.min(...values)),
    max: round4(Math.max(...values)),
    runs: values.length,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function suggestMaxDrop(stdev: number): number {
  return round4(Math.max(Z * stdev, MINIMUM_DROP));
}

export function calibrateThresholds(input: CalibrationInput): CalibratedThresholds {
  const { reports } = input;

  const recallValues = reports.map((r) => r.recallAtK);
  const hitRateValues = reports.map((r) => r.hitRate);

  const recallStats = statsFor(recallValues);
  const hitRateStats = statsFor(hitRateValues);

  const regression: RegressionThresholds = {
    maxRecallDrop: suggestMaxDrop(recallStats.stdev),
    maxHitRateDrop: suggestMaxDrop(hitRateStats.stdev),
  };

  // Per-query floors: collect min hitRate per query across all runs.
  // If any query was ever 0 in any run, set global floor to 0 (can't enforce a floor).
  // If all queries were always non-zero, set global floor to 1.
  const queryHitRates = new Map<string, number[]>();
  for (const report of reports) {
    for (const qr of report.queries) {
      const existing = queryHitRates.get(qr.query) ?? [];
      existing.push(qr.hitRate);
      queryHitRates.set(qr.query, existing);
    }
  }

  let anyQueryEverFailed = false;
  for (const values of queryHitRates.values()) {
    if (values.includes(0)) {
      anyQueryEverFailed = true;
      break;
    }
  }

  const perQueryFloors: PerQueryFloors = {
    minHitRate: anyQueryEverFailed ? 0 : 1,
  };

  // Synthetic fraction — deduplicate query names across all runs so mis-wired reports
  // (different run counts per corpus) don't inflate the denominator.
  const seenQueries = new Map<string, "user" | "synthetic" | undefined>();
  for (const report of reports) {
    for (const q of report.queries) {
      if (!seenQueries.has(q.query)) {
        seenQueries.set(q.query, q.source);
      }
    }
  }
  let syntheticFraction = 0;
  if (seenQueries.size > 0) {
    const syntheticCount = [...seenQueries.values()].filter((s) => s === "synthetic").length;
    syntheticFraction = round4(syntheticCount / seenQueries.size);
  }

  return {
    regression,
    perQueryFloors,
    stats: {
      recallAtK: recallStats,
      hitRate: hitRateStats,
    },
    syntheticFraction,
    runsUsed: reports.length,
  };
}
