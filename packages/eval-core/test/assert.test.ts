import { describe, expect, it } from "vitest";

import {
  DriftGateError,
  assertNoRegression,
  assertPerQueryFloors,
  assertRetrievalHealthy,
} from "../src/assert.js";
import {
  type FingerprintClassification,
  type MetricDelta,
  type QueryResultDelta,
  type RetrievalReportDelta,
} from "../src/compare.js";
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

const noFingerprint: FingerprintClassification = {
  corpusChanged: false,
  embeddingModelChanged: false,
  comparable: false,
};

function makeDelta(overrides: Partial<RetrievalReportDelta>): RetrievalReportDelta {
  return {
    k: 5,
    recallAtK: metricDelta(0.8, 0.8),
    precisionAtK: metricDelta(0.4, 0.4),
    mrr: metricDelta(0.7, 0.7),
    ndcgAtK: metricDelta(0.75, 0.75),
    hitRate: metricDelta(0.9, 0.9),
    fingerprint: noFingerprint,
    queries: [],
    anyRegressed: false,
    anyGateMetricRegressed: false,
    ...overrides,
  };
}

function makeQueryDelta(
  query: string,
  hitRateBefore: number,
  hitRateAfter: number,
  opts?: { source?: "user" | "synthetic"; recallBefore?: number; recallAfter?: number },
): QueryResultDelta {
  return {
    query,
    source: opts?.source,
    hitRate: metricDelta(hitRateBefore, hitRateAfter),
    recallAtK: metricDelta(opts?.recallBefore ?? hitRateBefore, opts?.recallAfter ?? hitRateAfter),
  };
}

// --- DriftGateError ---

describe("DriftGateError", () => {
  it("is an instance of Error", () => {
    const error = new DriftGateError("retriever-regressed", "test");
    expect(error instanceof Error).toBe(true);
  });

  it("exposes the kind discriminant", () => {
    const error = new DriftGateError("corpus-changed", "test");
    expect(error.kind).toBe("corpus-changed");
  });

  it("sets name to DriftGateError", () => {
    const error = new DriftGateError("embedding-model-changed", "test");
    expect(error.name).toBe("DriftGateError");
  });

  it("carries the message", () => {
    const error = new DriftGateError("per-query-floor-failed", "specific failure");
    expect(error.message).toBe("specific failure");
  });
});

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

  it("throws DriftGateError with kind retriever-regressed when recallAtK is below minimum", () => {
    const report = makeReport({ recallAtK: 0.6 });
    expect(() => {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    }).toThrow(DriftGateError);
    try {
      assertRetrievalHealthy(report, { minRecallAtK: 0.8 });
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("retriever-regressed");
    }
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
    const delta = makeDelta({ recallAtK: metricDelta(0.75, 0.5) });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.25 });
    }).not.toThrow();
  });

  it("throws DriftGateError with kind retriever-regressed when the drop exceeds the limit", () => {
    const delta = makeDelta({ recallAtK: metricDelta(0.84, 0.61) });
    try {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("retriever-regressed");
    }
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

  it("short-circuits with corpus-changed before checking metrics", () => {
    const delta = makeDelta({
      recallAtK: metricDelta(0.8, 0.1),
      fingerprint: { corpusChanged: true, embeddingModelChanged: false, comparable: false },
    });
    try {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("corpus-changed");
    }
  });

  it("short-circuits with embedding-model-changed before corpus check", () => {
    const delta = makeDelta({
      recallAtK: metricDelta(0.8, 0.1),
      fingerprint: { corpusChanged: true, embeddingModelChanged: true, comparable: false },
    });
    try {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("embedding-model-changed");
    }
  });

  it("does not throw for corpus-changed when metrics are fine — short-circuit fires instead", () => {
    const delta = makeDelta({
      fingerprint: { corpusChanged: true, embeddingModelChanged: false, comparable: false },
    });
    expect(() => {
      assertNoRegression(delta, {});
    }).toThrow(DriftGateError);
  });

  it("proceeds to metric check when fingerprint is absent (comparable=false but no change flags)", () => {
    const delta = makeDelta({
      recallAtK: metricDelta(0.8, 0.6),
      fingerprint: noFingerprint,
    });
    expect(() => {
      assertNoRegression(delta, { maxRecallDrop: 0.05 });
    }).toThrow("Retrieval regression detected");
  });

  it("checks hitRate threshold", () => {
    const delta = makeDelta({ hitRate: metricDelta(0.9, 0.7) });
    expect(() => {
      assertNoRegression(delta, { maxHitRateDrop: 0.05 });
    }).toThrow("Retrieval regression detected");
  });
});

// --- assertPerQueryFloors ---

describe("assertPerQueryFloors", () => {
  it("does not throw when queries array is empty", () => {
    const delta = makeDelta({ queries: [] });
    expect(() => {
      assertPerQueryFloors(delta, { minHitRate: 1 });
    }).not.toThrow();
  });

  it("does not throw when floors object is empty", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("q", 1, 0)],
    });
    expect(() => {
      assertPerQueryFloors(delta, {});
    }).not.toThrow();
  });

  it("does not throw when hitRate was 0 before AND 0 after", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("hard query", 0, 0)],
    });
    expect(() => {
      assertPerQueryFloors(delta, { minHitRate: 1 });
    }).not.toThrow();
  });

  it("does not throw when a query improves (0 → non-zero)", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("improving query", 0, 1)],
    });
    expect(() => {
      assertPerQueryFloors(delta, { minHitRate: 1 });
    }).not.toThrow();
  });

  it("throws per-query-floor-failed when a non-zero query regresses to below the floor", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("regressed query", 1, 0)],
    });
    try {
      assertPerQueryFloors(delta, { minHitRate: 1 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("per-query-floor-failed");
    }
  });

  it("includes the query text and before/after values in the message", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("How do I enable RLS?", 1, 0)],
    });
    try {
      assertPerQueryFloors(delta, { minHitRate: 1 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("How do I enable RLS?");
      expect(error.message).toContain("→");
    }
  });

  it("includes source tag in the message when present", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("q", 1, 0, { source: "user" })],
    });
    try {
      assertPerQueryFloors(delta, { minHitRate: 1 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("[source: user]");
    }
  });

  it("collects multiple violations in one throw", () => {
    const delta = makeDelta({
      queries: [
        makeQueryDelta("query A", 1, 0, { source: "user" }),
        makeQueryDelta("query B", 1, 0, { source: "synthetic" }),
      ],
    });
    try {
      assertPerQueryFloors(delta, { minHitRate: 1 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("query A");
      expect(error.message).toContain("query B");
      expect(error.message).toContain("2 queries");
    }
  });

  it("does not floor queries that were previously failing — only regressions from non-zero", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("always hard", 0, 0), makeQueryDelta("regressed", 1, 0)],
    });
    try {
      assertPerQueryFloors(delta, { minHitRate: 1 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("1 queries");
      expect(error.message).toContain("regressed");
      expect(error.message).not.toContain("always hard");
    }
  });

  it("checks recallAtK floor independently from hitRate", () => {
    const delta = makeDelta({
      queries: [makeQueryDelta("q", 1, 1, { recallBefore: 0.8, recallAfter: 0 })],
    });
    try {
      assertPerQueryFloors(delta, { minRecallAtK: 0.5 });
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof DriftGateError)) throw error;
      expect(error.kind).toBe("per-query-floor-failed");
      expect(error.message).toContain("recallAtK");
    }
  });
});
