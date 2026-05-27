import { type RetrievalReport } from "./evaluate.js";

export interface MetricDelta {
  before: number;
  after: number;
  delta: number;
  regressed: boolean;
}

export interface RetrievalReportDelta {
  k: number;
  recallAtK: MetricDelta;
  precisionAtK: MetricDelta;
  mrr: MetricDelta;
  ndcgAtK: MetricDelta;
  hitRate: MetricDelta;
  anyRegressed: boolean;
}

function diff(before: number, after: number): MetricDelta {
  const delta = after - before;
  return { before, after, delta, regressed: delta < 0 };
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

  return {
    k: after.k,
    recallAtK,
    precisionAtK,
    mrr,
    ndcgAtK,
    hitRate,
    anyRegressed:
      recallAtK.regressed ||
      precisionAtK.regressed ||
      mrr.regressed ||
      ndcgAtK.regressed ||
      hitRate.regressed,
  };
}
