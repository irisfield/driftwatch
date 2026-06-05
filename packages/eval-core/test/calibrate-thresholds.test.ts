import { describe, expect, it } from "vitest";

import { calibrateThresholds } from "../src/calibrate-thresholds.js";
import { type RetrievalReport } from "../src/evaluate.js";

function makeReport(overrides: Partial<RetrievalReport>): RetrievalReport {
  return {
    k: 5,
    recallAtK: 0.8,
    precisionAtK: 0.4,
    mrr: 0.7,
    ndcgAtK: 0.75,
    hitRate: 0.9,
    queries: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReports(recallValues: number[], hitRateValues: number[]): RetrievalReport[] {
  return recallValues.map((recall, i) =>
    makeReport({ recallAtK: recall, hitRate: hitRateValues[i] ?? 0.9 }),
  );
}

describe("calibrateThresholds", () => {
  it("maxRecallDrop is never below MINIMUM_DROP (0.01)", () => {
    // Identical reports — stdev = 0, so maxDrop = max(0, 0.01) = 0.01
    const reports = makeReports([0.8, 0.8, 0.8, 0.8, 0.8], [0.9, 0.9, 0.9, 0.9, 0.9]);
    const { regression } = calibrateThresholds({ reports });
    expect(regression.maxRecallDrop).toBeGreaterThanOrEqual(0.01);
    expect(regression.maxHitRateDrop).toBeGreaterThanOrEqual(0.01);
  });

  it("is deterministic — same reports always produce same thresholds", () => {
    const reports = makeReports([0.8, 0.75, 0.82, 0.78, 0.77], [0.9, 0.88, 0.91, 0.89, 0.87]);
    const t1 = calibrateThresholds({ reports });
    const t2 = calibrateThresholds({ reports });
    expect(t1.regression.maxRecallDrop).toBe(t2.regression.maxRecallDrop);
    expect(t1.regression.maxHitRateDrop).toBe(t2.regression.maxHitRateDrop);
  });

  it("produces larger maxDrop when variance is high", () => {
    const lowVar = makeReports([0.8, 0.8, 0.8, 0.8, 0.8], [0.9, 0.9, 0.9, 0.9, 0.9]);
    const highVar = makeReports([0.5, 0.9, 0.5, 0.9, 0.5], [0.5, 0.9, 0.5, 0.9, 0.5]);
    const tLow = calibrateThresholds({ reports: lowVar });
    const tHigh = calibrateThresholds({ reports: highVar });
    expect(tHigh.regression.maxRecallDrop).toBeGreaterThan(tLow.regression.maxRecallDrop ?? 0);
  });

  it("reports runsUsed equal to the number of reports", () => {
    const reports = makeReports([0.8, 0.75, 0.82], [0.9, 0.88, 0.91]);
    const { runsUsed } = calibrateThresholds({ reports });
    expect(runsUsed).toBe(3);
  });

  it("includes recallAtK and hitRate in stats", () => {
    const reports = makeReports([0.8, 0.75], [0.9, 0.88]);
    const { stats } = calibrateThresholds({ reports });
    expect(stats.recallAtK).toBeDefined();
    expect(stats.hitRate).toBeDefined();
  });

  it("stats.runs equals the number of reports", () => {
    const reports = makeReports([0.8, 0.75, 0.82], [0.9, 0.88, 0.91]);
    const { stats } = calibrateThresholds({ reports });
    expect(stats.recallAtK?.runs).toBe(3);
  });

  it("sets syntheticFraction to 1.0 when all entries are synthetic", () => {
    const report = makeReport({
      queries: [
        {
          query: "q1",
          source: "synthetic",
          relevant: [],
          retrieved: [],
          recallAtK: 0.8,
          precisionAtK: 0.4,
          mrr: 0.7,
          ndcgAtK: 0.75,
          hitRate: 0.9,
        },
        {
          query: "q2",
          source: "synthetic",
          relevant: [],
          retrieved: [],
          recallAtK: 0.8,
          precisionAtK: 0.4,
          mrr: 0.7,
          ndcgAtK: 0.75,
          hitRate: 0.9,
        },
      ],
    });
    const { syntheticFraction } = calibrateThresholds({ reports: [report, report] });
    expect(syntheticFraction).toBe(1);
  });

  it("sets syntheticFraction to 0 when no entries have source set", () => {
    const report = makeReport({
      queries: [
        {
          query: "q1",
          relevant: [],
          retrieved: [],
          recallAtK: 0.8,
          precisionAtK: 0.4,
          mrr: 0.7,
          ndcgAtK: 0.75,
          hitRate: 0.9,
        },
      ],
    });
    const { syntheticFraction } = calibrateThresholds({ reports: [report] });
    expect(syntheticFraction).toBe(0);
  });

  it("sets perQueryFloors.minHitRate to 0 when any query had hitRate = 0 in any run", () => {
    const reportWithZero = makeReport({
      queries: [
        {
          query: "hard",
          relevant: [],
          retrieved: [],
          recallAtK: 0,
          precisionAtK: 0,
          mrr: 0,
          ndcgAtK: 0,
          hitRate: 0,
        },
      ],
    });
    const reportWithHit = makeReport({
      queries: [
        {
          query: "hard",
          relevant: [],
          retrieved: [],
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          ndcgAtK: 1,
          hitRate: 1,
        },
      ],
    });
    const { perQueryFloors } = calibrateThresholds({ reports: [reportWithZero, reportWithHit] });
    expect(perQueryFloors.minHitRate).toBe(0);
  });

  it("sets perQueryFloors.minHitRate to 1 when all queries always hit", () => {
    const reports = [
      makeReport({
        queries: [
          {
            query: "q",
            relevant: [],
            retrieved: [],
            recallAtK: 1,
            precisionAtK: 1,
            mrr: 1,
            ndcgAtK: 1,
            hitRate: 1,
          },
        ],
      }),
      makeReport({
        queries: [
          {
            query: "q",
            relevant: [],
            retrieved: [],
            recallAtK: 1,
            precisionAtK: 1,
            mrr: 1,
            ndcgAtK: 1,
            hitRate: 1,
          },
        ],
      }),
    ];
    const { perQueryFloors } = calibrateThresholds({ reports });
    expect(perQueryFloors.minHitRate).toBe(1);
  });

  it("handles an empty queries list in reports", () => {
    const reports = makeReports([0.8, 0.75], [0.9, 0.88]);
    const { perQueryFloors } = calibrateThresholds({ reports });
    // No queries ever failed → floor is 1
    expect(perQueryFloors.minHitRate).toBe(1);
  });
});
