import { type QueryResult, type RetrievalReport } from "./evaluate.js";

import type { CorpusFingerprint } from "./fingerprint.js";

export interface MetricDelta {
  before: number;
  after: number;
  delta: number;
  regressed: boolean;
}

export interface FingerprintClassification {
  corpusChanged: boolean;
  embeddingModelChanged: boolean;
  // true only when both reports have fingerprints AND neither field changed
  comparable: boolean;
}

// Only gate metrics are required; diagnostic metrics are optional
export interface QueryResultDelta {
  query: string;
  source?: "user" | "synthetic";
  hitRate: MetricDelta;
  recallAtK: MetricDelta;
  mrr?: MetricDelta;
  ndcgAtK?: MetricDelta;
  precisionAtK?: MetricDelta;
}

export interface RetrievalReportDelta {
  k: number;

  // Aggregate mean deltas
  recallAtK: MetricDelta;
  precisionAtK: MetricDelta;
  mrr: MetricDelta;
  ndcgAtK: MetricDelta;
  hitRate: MetricDelta;

  // Fingerprint classification — determines how the assert layer interprets metric drops
  fingerprint: FingerprintClassification;

  // Per-query deltas for assertPerQueryFloors
  queries: QueryResultDelta[];

  // anyRegressed: OR of all five means — backwards compat, not used by CI gate
  anyRegressed: boolean;

  // anyGateMetricRegressed: Recall@K OR HitRate@K regressed — what CI gates on
  anyGateMetricRegressed: boolean;
}

function diff(before: number, after: number): MetricDelta {
  const delta = after - before;
  return { before, after, delta, regressed: delta < 0 };
}

function classifyFingerprints(
  before: CorpusFingerprint | undefined,
  after: CorpusFingerprint | undefined,
): FingerprintClassification {
  if (before === undefined || after === undefined) {
    return { corpusChanged: false, embeddingModelChanged: false, comparable: false };
  }
  const corpusChanged = before.corpusHash !== after.corpusHash;
  const embeddingModelChanged = before.embeddingModel !== after.embeddingModel;
  return {
    corpusChanged,
    embeddingModelChanged,
    comparable: !corpusChanged && !embeddingModelChanged,
  };
}

function queryDeltaForNew(afterQ: QueryResult): QueryResultDelta {
  const nan: MetricDelta = {
    before: Number.NaN,
    after: Number.NaN,
    delta: Number.NaN,
    regressed: false,
  };
  return {
    query: afterQ.query,
    source: afterQ.source,
    hitRate: { before: Number.NaN, after: afterQ.hitRate, delta: Number.NaN, regressed: false },
    recallAtK: { before: Number.NaN, after: afterQ.recallAtK, delta: Number.NaN, regressed: false },
    mrr: { ...nan, after: afterQ.mrr },
    ndcgAtK: { ...nan, after: afterQ.ndcgAtK },
    precisionAtK: { ...nan, after: afterQ.precisionAtK },
  };
}

export function compareReports(
  before: RetrievalReport,
  after: RetrievalReport,
): RetrievalReportDelta {
  const recallAtK = diff(before.recallAtK, after.recallAtK);
  const precisionAtK = diff(before.precisionAtK, after.precisionAtK);
  const mrr = diff(before.mrr, after.mrr);
  const ndcgAtK = diff(before.ndcgAtK, after.ndcgAtK);
  const hitRate = diff(before.hitRate, after.hitRate);

  const fingerprint = classifyFingerprints(before.fingerprint, after.fingerprint);

  const beforeMap = new Map<string, QueryResult>(before.queries.map((q) => [q.query, q]));
  const queries: QueryResultDelta[] = after.queries.map((afterQ) => {
    const beforeQ = beforeMap.get(afterQ.query);
    if (beforeQ === undefined) {
      return queryDeltaForNew(afterQ);
    }
    return {
      query: afterQ.query,
      source: afterQ.source,
      hitRate: diff(beforeQ.hitRate, afterQ.hitRate),
      recallAtK: diff(beforeQ.recallAtK, afterQ.recallAtK),
      mrr: diff(beforeQ.mrr, afterQ.mrr),
      ndcgAtK: diff(beforeQ.ndcgAtK, afterQ.ndcgAtK),
      precisionAtK: diff(beforeQ.precisionAtK, afterQ.precisionAtK),
    };
  });

  return {
    k: after.k,
    recallAtK,
    precisionAtK,
    mrr,
    ndcgAtK,
    hitRate,
    fingerprint,
    queries,
    anyRegressed:
      recallAtK.regressed ||
      precisionAtK.regressed ||
      mrr.regressed ||
      ndcgAtK.regressed ||
      hitRate.regressed,
    anyGateMetricRegressed: recallAtK.regressed || hitRate.regressed,
  };
}
