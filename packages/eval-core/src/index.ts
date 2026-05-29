export {
  assertNoRegression,
  assertRetrievalHealthy,
  type HealthThresholds,
  type RegressionThresholds,
} from "./assert.js";
export { compareReports, type MetricDelta, type RetrievalReportDelta } from "./compare.js";
export {
  type EvaluateOptions,
  evaluateRetrieval,
  type QueryResult,
  type RetrievalReport,
} from "./evaluate.js";
export {
  type GoldenDataset,
  type GoldenEntry,
  goldenDatasetSchema,
  goldenEntrySchema,
  loadGoldenDataset,
  validateGoldenDataset,
} from "./golden-schema.js";
export { judgeRelevance, type JudgeChunk, type JudgeOptions, type JudgeResult } from "./judge.js";
export { hitRate, mrr, ndcgAtK, precisionAtK, recallAtK } from "./metrics.js";
