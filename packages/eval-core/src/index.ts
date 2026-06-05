export {
  assertNoRegression,
  assertPerQueryFloors,
  assertRetrievalHealthy,
  DriftGateError,
  type DriftFailureKind,
  type HealthThresholds,
  type PerQueryFloors,
  type RegressionThresholds,
} from "./assert.js";
export {
  calibrateThresholds,
  type CalibrationInput,
  type CalibrationStats,
  type CalibratedThresholds,
} from "./calibrate-thresholds.js";
export {
  compareReports,
  type FingerprintClassification,
  type MetricDelta,
  type QueryResultDelta,
  type RetrievalReportDelta,
} from "./compare.js";
export {
  type EvaluateOptions,
  evaluateRetrieval,
  type QueryResult,
  type RetrievalReport,
} from "./evaluate.js";
export { computeCorpusFingerprint, type CorpusFingerprint } from "./fingerprint.js";
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
