import { describe, expect, it } from "vitest";

import { compareReports } from "../src/compare.js";
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

describe("compareReports", () => {
  it("computes positive deltas when all metrics improve", () => {
    const before = makeReport({ recallAtK: 0.6, mrr: 0.5, ndcgAtK: 0.55 });
    const after = makeReport({ recallAtK: 0.8, mrr: 0.7, ndcgAtK: 0.75 });
    const delta = compareReports(before, after);

    expect(delta.recallAtK.delta).toBeCloseTo(0.2);
    expect(delta.recallAtK.regressed).toBe(false);
    expect(delta.mrr.delta).toBeCloseTo(0.2);
    expect(delta.mrr.regressed).toBe(false);
    expect(delta.anyRegressed).toBe(false);
  });

  it("computes negative deltas and flags regression when metrics drop", () => {
    const before = makeReport({ recallAtK: 0.8, mrr: 0.7 });
    const after = makeReport({ recallAtK: 0.6, mrr: 0.5 });
    const delta = compareReports(before, after);

    expect(delta.recallAtK.delta).toBeCloseTo(-0.2);
    expect(delta.recallAtK.regressed).toBe(true);
    expect(delta.mrr.delta).toBeCloseTo(-0.2);
    expect(delta.mrr.regressed).toBe(true);
    expect(delta.anyRegressed).toBe(true);
  });

  it("does not flag regression when delta is exactly zero", () => {
    const report = makeReport({});
    const delta = compareReports(report, report);

    expect(delta.recallAtK.delta).toBe(0);
    expect(delta.recallAtK.regressed).toBe(false);
    expect(delta.anyRegressed).toBe(false);
  });

  it("sets anyRegressed true when only one metric regresses", () => {
    const before = makeReport({ ndcgAtK: 0.8 });
    const after = makeReport({ ndcgAtK: 0.6 });
    const delta = compareReports(before, after);

    expect(delta.ndcgAtK.regressed).toBe(true);
    expect(delta.recallAtK.regressed).toBe(false);
    expect(delta.anyRegressed).toBe(true);
  });

  it("preserves before and after values in each MetricDelta", () => {
    const before = makeReport({ recallAtK: 0.5 });
    const after = makeReport({ recallAtK: 0.9 });
    const delta = compareReports(before, after);

    expect(delta.recallAtK.before).toBeCloseTo(0.5);
    expect(delta.recallAtK.after).toBeCloseTo(0.9);
    expect(delta.recallAtK.delta).toBeCloseTo(0.4);
  });

  it("takes k from the after report", () => {
    const before = makeReport({ k: 3 });
    const after = makeReport({ k: 5 });
    const delta = compareReports(before, after);
    expect(delta.k).toBe(5);
  });

  it("handles all five metrics independently", () => {
    // Only hitRate regresses; all others stay equal or improve
    const before = makeReport({ hitRate: 1, precisionAtK: 0.3 });
    const after = makeReport({ hitRate: 0.8, precisionAtK: 0.5 });
    const delta = compareReports(before, after);

    expect(delta.hitRate.regressed).toBe(true);
    expect(delta.precisionAtK.regressed).toBe(false);
    expect(delta.recallAtK.regressed).toBe(false);
    expect(delta.mrr.regressed).toBe(false);
    expect(delta.ndcgAtK.regressed).toBe(false);
    expect(delta.anyRegressed).toBe(true);
  });
});
