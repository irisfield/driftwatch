import { describe, expect, it } from "vitest";

import { assertNoRegression, assertRetrievalHealthy } from "../src/assert.js";
import { type MetricDelta, type RetrievalReportDelta } from "../src/compare.js";
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

function metricDelta(before: number, after: number): MetricDelta {
  return { before, after, delta: after - before, regressed: after < before };
}

function makeDelta(overrides: Partial<RetrievalReportDelta>): RetrievalReportDelta {
  return {
    k: 5,
    recallAtK: metricDelta(0.8, 0.8),
    precisionAtK: metricDelta(0.4, 0.4),
    mrr: metricDelta(0.7, 0.7),
    ndcgAtK: metricDelta(0.75, 0.75),
    hitRate: metricDelta(0.9, 0.9),
    anyRegressed: false,
    ...overrides,
  };
}

// --- assertRetrievalHealthy ---

describe("assertRetrievalHealthy", () => {
  it("does not throw when all metrics are above their minimums", () => {
    const report = makeReport({ recallAtK: 0.85, mrr: 0.75 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8, minMrr: 0.7 });
    }).not.toThrow();
  });

  it("does not throw when thresholds are exactly met", () => {
    const report = makeReport({ recallAtK: 0.8 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    }).not.toThrow();
  });

  it("throws when recallAtK is below minimum", () => {
    const report = makeReport({ recallAtK: 0.6 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    }).toThrow("Retrieval health check failed");
  });

  it("includes the metric name and values in the error", () => {
    const report = makeReport({ recallAtK: 0.61 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    }).toThrow("recallAtK");
  });

  it("collects all violations in a single throw", () => {
    const report = makeReport({ recallAtK: 0.5, mrr: 0.3 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8, minMrr: 0.7 });
    }).toThrow("mrr");
  });

  it("does not throw when no thresholds are provided", () => {
    const report = makeReport({ recallAtK: 0 });
    expect(() => {
      assertRetrievalHealthy(report, {});
    }).not.toThrow();
  });

  it("only checks metrics with a threshold — omitted metrics are ignored", () => {
    // ndcgAtK is 0 but no threshold set for it — should not throw
    const report = makeReport({ recallAtK: 0.9, ndcgAtK: 0 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    }).not.toThrow();
  });

  it("throws for precisionAtK when below minimum", () => {
    expect(() => {
      assertRetrievalHealthy(makeReport({ precisionAtK: 0.1 }), { minPrecisionAtK: 0.4 });
    }).toThrow("precisionAtK");
  });

  it("throws for ndcgAtK when below minimum", () => {
    expect(() => {
      assertRetrievalHealthy(makeReport({ ndcgAtK: 0.5 }), { minNdcgAtK: 0.8 });
    }).toThrow("ndcgAtK");
  });

  it("throws for hitRate when below minimum", () => {
    expect(() => {
      assertRetrievalHealthy(makeReport({ hitRate: 0.5 }), { minHitRate: 0.9 });
    }).toThrow("hitRate");
  });
});

// --- assertNoRegression ---

describe("assertNoRegression", () => {
  it("does not throw when no metric regressed beyond its limit", () => {
    const delta = makeDelta({ recallAtK: metricDelta(0.8, 0.77) });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
    }).not.toThrow();
  });

  it("does not throw when the drop exactly equals the limit", () => {
    // Use exact binary fractions (0.75, 0.5, 0.25) to avoid IEEE 754 rounding
    const delta = makeDelta({ recallAtK: metricDelta(0.75, 0.5) });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.25 });
    }).not.toThrow();
  });

  it("throws when the drop exceeds the limit", () => {
    const delta = makeDelta({ recallAtK: metricDelta(0.84, 0.61) });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
    }).toThrow("Retrieval regression detected");
  });

  it("includes the metric name, drop, limit, before, and after in the message", () => {
    const delta = makeDelta({ recallAtK: metricDelta(0.84, 0.61) });
    try {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("recallAtK");
      expect(error.message).toContain("before:");
      expect(error.message).toContain("after:");
      expect(error.message).toContain("limit:");
    }
  });

  it("collects all regressions in a single throw", () => {
    const delta = makeDelta({
      recallAtK: metricDelta(0.8, 0.6),
      mrr: metricDelta(0.7, 0.4),
    });
    try {
      assertNoRegression(delta, { maxRecallDrop: 0.05, maxMrrDrop: 0.05 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("recallAtK");
      expect(error.message).toContain("mrr");
    }
  });

  it("does not throw when no thresholds are provided", () => {
    const delta = makeDelta({ recallAtK: metricDelta(1, 0) });
    expect(() => {
      assertNoRegression(delta, {});
    }).not.toThrow();
  });

  it("does not throw when a metric improves", () => {
    const delta = makeDelta({ recallAtK: metricDelta(0.6, 0.9) });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
    }).not.toThrow();
  });
});
