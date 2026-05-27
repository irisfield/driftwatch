import { type RetrievalReportDelta } from "./compare.js";
import { type RetrievalReport } from "./evaluate.js";

export interface HealthThresholds {
  minRecallAtK?: number;
  minPrecisionAtK?: number;
  minMrr?: number;
  minNdcgAtK?: number;
  minHitRate?: number;
}

export interface RegressionThresholds {
  maxRecallDrop?: number;
  maxPrecisionDrop?: number;
  maxMrrDrop?: number;
  maxNdcgDrop?: number;
  maxHitRateDrop?: number;
}

function fmt(n: number): string {
  return n.toFixed(4);
}

export function assertRetrievalHealthy(
  report: RetrievalReport,
  thresholds: HealthThresholds,
): void {
  const violations: string[] = [];

  if (thresholds.minRecallAtK !== undefined && report.recallAtK < thresholds.minRecallAtK) {
    violations.push(
      `  recallAtK: ${fmt(report.recallAtK)} < minimum ${fmt(thresholds.minRecallAtK)}`,
    );
  }
  if (
    thresholds.minPrecisionAtK !== undefined &&
    report.precisionAtK < thresholds.minPrecisionAtK
  ) {
    violations.push(
      `  precisionAtK: ${fmt(report.precisionAtK)} < minimum ${fmt(thresholds.minPrecisionAtK)}`,
    );
  }
  if (thresholds.minMrr !== undefined && report.mrr < thresholds.minMrr) {
    violations.push(`  mrr: ${fmt(report.mrr)} < minimum ${fmt(thresholds.minMrr)}`);
  }
  if (thresholds.minNdcgAtK !== undefined && report.ndcgAtK < thresholds.minNdcgAtK) {
    violations.push(`  ndcgAtK: ${fmt(report.ndcgAtK)} < minimum ${fmt(thresholds.minNdcgAtK)}`);
  }
  if (thresholds.minHitRate !== undefined && report.hitRate < thresholds.minHitRate) {
    violations.push(`  hitRate: ${fmt(report.hitRate)} < minimum ${fmt(thresholds.minHitRate)}`);
  }

  if (violations.length > 0) {
    throw new Error(`Retrieval health check failed:\n${violations.join("\n")}`);
  }
}

export function assertNoRegression(
  delta: RetrievalReportDelta,
  thresholds: RegressionThresholds,
): void {
  const violations: string[] = [];

  function check(
    name: string,
    d: { before: number; after: number; delta: number },
    maxDrop: number | undefined,
  ): void {
    if (maxDrop !== undefined && d.delta < -maxDrop) {
      violations.push(
        `  ${name} dropped ${fmt(-d.delta)} (limit: ${fmt(maxDrop)}) — before: ${fmt(d.before)}, after: ${fmt(d.after)}`,
      );
    }
  }

  check("recallAtK", delta.recallAtK, thresholds.maxRecallDrop);
  check("precisionAtK", delta.precisionAtK, thresholds.maxPrecisionDrop);
  check("mrr", delta.mrr, thresholds.maxMrrDrop);
  check("ndcgAtK", delta.ndcgAtK, thresholds.maxNdcgDrop);
  check("hitRate", delta.hitRate, thresholds.maxHitRateDrop);

  if (violations.length > 0) {
    throw new Error(`Retrieval regression detected:\n${violations.join("\n")}`);
  }
}
