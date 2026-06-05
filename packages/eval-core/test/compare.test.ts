import { describe, expect, it } from "vitest";

import { compareReports } from "../src/compare.js";
import { type RetrievalReport } from "../src/evaluate.js";
import { type CorpusFingerprint } from "../src/fingerprint.js";

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

const FP_A: CorpusFingerprint = { corpusHash: "aaaa", embeddingModel: "text-embedding-3-small" };
const FP_B: CorpusFingerprint = { corpusHash: "bbbb", embeddingModel: "text-embedding-3-small" };
const FP_LARGE: CorpusFingerprint = {
  corpusHash: "aaaa",
  embeddingModel: "text-embedding-3-large",
};

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

  // --- anyGateMetricRegressed ---

  it("sets anyGateMetricRegressed true when recallAtK regresses", () => {
    const before = makeReport({ recallAtK: 0.8 });
    const after = makeReport({ recallAtK: 0.6 });
    const delta = compareReports(before, after);
    expect(delta.anyGateMetricRegressed).toBe(true);
  });

  it("sets anyGateMetricRegressed true when hitRate regresses", () => {
    const before = makeReport({ hitRate: 0.9 });
    const after = makeReport({ hitRate: 0.7 });
    const delta = compareReports(before, after);
    expect(delta.anyGateMetricRegressed).toBe(true);
  });

  it("does NOT set anyGateMetricRegressed when only mrr regresses", () => {
    const before = makeReport({ mrr: 0.8 });
    const after = makeReport({ mrr: 0.4 });
    const delta = compareReports(before, after);
    expect(delta.anyGateMetricRegressed).toBe(false);
    expect(delta.anyRegressed).toBe(true);
  });

  it("does NOT set anyGateMetricRegressed when only ndcgAtK regresses", () => {
    const before = makeReport({ ndcgAtK: 0.8 });
    const after = makeReport({ ndcgAtK: 0.4 });
    const delta = compareReports(before, after);
    expect(delta.anyGateMetricRegressed).toBe(false);
  });

  // --- fingerprint classification ---

  it("sets fingerprint.comparable true when both fingerprints match", () => {
    const before = makeReport({ fingerprint: FP_A });
    const after = makeReport({ fingerprint: FP_A });
    const delta = compareReports(before, after);
    expect(delta.fingerprint.comparable).toBe(true);
    expect(delta.fingerprint.corpusChanged).toBe(false);
    expect(delta.fingerprint.embeddingModelChanged).toBe(false);
  });

  it("sets fingerprint.corpusChanged true when corpusHash differs", () => {
    const before = makeReport({ fingerprint: FP_A });
    const after = makeReport({ fingerprint: FP_B });
    const delta = compareReports(before, after);
    expect(delta.fingerprint.corpusChanged).toBe(true);
    expect(delta.fingerprint.comparable).toBe(false);
  });

  it("sets fingerprint.embeddingModelChanged true when embeddingModel differs", () => {
    const before = makeReport({ fingerprint: FP_A });
    const after = makeReport({ fingerprint: FP_LARGE });
    const delta = compareReports(before, after);
    expect(delta.fingerprint.embeddingModelChanged).toBe(true);
    expect(delta.fingerprint.comparable).toBe(false);
  });

  it("sets all fingerprint flags to false when either report lacks a fingerprint", () => {
    const before = makeReport({});
    const after = makeReport({ fingerprint: FP_A });
    const delta = compareReports(before, after);
    expect(delta.fingerprint.corpusChanged).toBe(false);
    expect(delta.fingerprint.embeddingModelChanged).toBe(false);
    expect(delta.fingerprint.comparable).toBe(false);
  });

  it("sets all fingerprint flags to false when both reports lack fingerprints", () => {
    const before = makeReport({});
    const after = makeReport({});
    const delta = compareReports(before, after);
    expect(delta.fingerprint.corpusChanged).toBe(false);
    expect(delta.fingerprint.embeddingModelChanged).toBe(false);
    expect(delta.fingerprint.comparable).toBe(false);
  });

  // --- per-query deltas ---

  it("produces an empty queries array when both reports have no queries", () => {
    const delta = compareReports(makeReport({}), makeReport({}));
    expect(delta.queries).toHaveLength(0);
  });

  it("matches queries by query string and computes per-query deltas", () => {
    const before = makeReport({
      queries: [
        {
          query: "q1",
          relevant: ["a"],
          retrieved: ["a"],
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          ndcgAtK: 1,
          hitRate: 1,
        },
      ],
    });
    const after = makeReport({
      queries: [
        {
          query: "q1",
          relevant: ["a"],
          retrieved: [],
          recallAtK: 0,
          precisionAtK: 0,
          mrr: 0,
          ndcgAtK: 0,
          hitRate: 0,
        },
      ],
    });
    const delta = compareReports(before, after);
    expect(delta.queries).toHaveLength(1);
    expect(delta.queries[0]?.query).toBe("q1");
    expect(delta.queries[0]?.hitRate.before).toBe(1);
    expect(delta.queries[0]?.hitRate.after).toBe(0);
    expect(delta.queries[0]?.hitRate.regressed).toBe(true);
  });

  it("marks new queries (in after but not before) with NaN before values", () => {
    const after = makeReport({
      queries: [
        {
          query: "new-query",
          relevant: ["a"],
          retrieved: ["a"],
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          ndcgAtK: 1,
          hitRate: 1,
        },
      ],
    });
    const delta = compareReports(makeReport({}), after);
    expect(delta.queries).toHaveLength(1);
    expect(Number.isNaN(delta.queries[0]?.hitRate.before)).toBe(true);
    expect(delta.queries[0]?.hitRate.regressed).toBe(false);
  });

  it("omits queries that were in before but not in after", () => {
    const before = makeReport({
      queries: [
        {
          query: "removed-query",
          relevant: ["a"],
          retrieved: ["a"],
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          ndcgAtK: 1,
          hitRate: 1,
        },
      ],
    });
    const delta = compareReports(before, makeReport({}));
    expect(delta.queries).toHaveLength(0);
  });

  it("carries source field from after queries into QueryResultDelta", () => {
    const after = makeReport({
      queries: [
        {
          query: "q",
          source: "synthetic",
          relevant: ["a"],
          retrieved: ["a"],
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          ndcgAtK: 1,
          hitRate: 1,
        },
      ],
    });
    const delta = compareReports(makeReport({}), after);
    expect(delta.queries[0]?.source).toBe("synthetic");
  });
});
