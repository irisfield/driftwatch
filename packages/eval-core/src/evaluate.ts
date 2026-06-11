import { type GoldenDataset } from "./golden-schema.js";
import { hitRate, mrr, ndcgAtK, precisionAtK, recallAtK } from "./metrics.js";

import type { CorpusFingerprint } from "./fingerprint.js";

export interface QueryResult {
  query: string;
  source?: "user" | "synthetic" | undefined;
  relevant: string[];
  retrieved: string[];
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  hitRate: number;
}

export interface RetrievalReport {
  k: number;
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  hitRate: number;
  queries: QueryResult[];
  evaluatedAt: string;
  fingerprint?: CorpusFingerprint | undefined;
}

export interface EvaluateOptions {
  golden: GoldenDataset;
  retrieve: (query: string) => Promise<string[]>;
  k: number;
  fingerprint?: CorpusFingerprint;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function evaluateRetrieval(options: EvaluateOptions): Promise<RetrievalReport> {
  const { golden, retrieve, k } = options;
  const evaluatedAt = new Date().toISOString();
  const queryResults: QueryResult[] = [];

  for (const entry of golden) {
    const retrieved = await retrieve(entry.query);
    queryResults.push({
      query: entry.query,
      source: entry.source,
      relevant: entry.relevant,
      retrieved,
      recallAtK: recallAtK(retrieved, entry.relevant, k),
      precisionAtK: precisionAtK(retrieved, entry.relevant, k),
      mrr: mrr(retrieved, entry.relevant),
      ndcgAtK: ndcgAtK(retrieved, entry.relevant, k),
      hitRate: hitRate(retrieved, entry.relevant, k),
    });
  }

  return {
    k,
    recallAtK: mean(queryResults.map((q) => q.recallAtK)),
    precisionAtK: mean(queryResults.map((q) => q.precisionAtK)),
    mrr: mean(queryResults.map((q) => q.mrr)),
    ndcgAtK: mean(queryResults.map((q) => q.ndcgAtK)),
    hitRate: mean(queryResults.map((q) => q.hitRate)),
    queries: queryResults,
    evaluatedAt,
    fingerprint: options.fingerprint,
  };
}
