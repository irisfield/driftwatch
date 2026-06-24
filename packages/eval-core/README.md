# @irisfield/driftwatch

Retrieval evaluation and CI gate for TypeScript. Supply a `retrieve()` function; driftwatch runs it against a golden dataset, computes Recall@K, MRR, nDCG, Precision@K, and HitRate, diffs against a committed baseline, and throws when results regress past your configured limits.

Runtime-agnostic — works with any vector DB, any embedding model, any retrieval stack.

## Install

```bash
deno add jsr:@irisfield/driftwatch
```

## Quickstart

```typescript
import {
  evaluateRetrieval,
  assertRetrievalHealthy,
  loadGoldenDataset,
} from "@irisfield/driftwatch";

const golden = await loadGoldenDataset("golden/my-corpus.json");

const report = await evaluateRetrieval({
  golden,
  retrieve: async (query) => myVectorSearch(query), // ranked doc IDs, most relevant first
  k: 5,
});

assertRetrievalHealthy(report, { minRecallAtK: 0.7, minMrr: 0.6 });
```

`assertRetrievalHealthy` throws `DriftGateError` when metrics fall below thresholds. To diff against a committed baseline instead:

```typescript
import {
  evaluateRetrieval,
  compareReports,
  assertNoRegression,
  loadGoldenDataset,
} from "@irisfield/driftwatch";

const baseline = JSON.parse(await Deno.readTextFile("baseline.json"));
const report = await evaluateRetrieval({ golden, retrieve, k: 5 });

assertNoRegression(compareReports(baseline, report), {
  maxRecallDrop: 0.05,
  maxHitRateDrop: 0.05,
});
```

## What a regression looks like

```
Retrieval regression detected:
  recallAtK dropped 0.2300 (limit: 0.0500) — before: 0.9400, after: 0.7100
  hitRate dropped 0.1800 (limit: 0.0500) — before: 0.9700, after: 0.7900
Golden set: 2 queries (1 user, 1 synthetic)
```

The thrown `DriftGateError` carries a typed `kind` so CI can branch on why it failed:

- `"retriever-regressed"` — metrics dropped past configured limits
- `"embedding-model-changed"` — embedding model changed since baseline; re-baseline required
- `"corpus-changed"` — corpus content changed since baseline; re-baseline required
- `"per-query-floor-failed"` — a specific query regressed below its per-query floor

## API

### `evaluateRetrieval(options)`

Runs `retrieve(query)` for each entry in the golden dataset and returns a `RetrievalReport`.

```typescript
interface EvaluateOptions {
  golden: GoldenDataset;
  retrieve: (query: string) => Promise<string[]>; // ranked doc IDs
  k: number;
  embeddingModel?: string;
  corpusFingerprint?: string;
}
```

### `compareReports(baseline, current)`

Returns a `RetrievalReportDelta` with per-metric deltas and fingerprint classification.

### `assertRetrievalHealthy(report, thresholds)`

Throws `DriftGateError("retriever-regressed")` if any metric falls below its minimum.

### `assertNoRegression(delta, thresholds)`

Throws `DriftGateError` if metrics regressed past configured max drops, or if the embedding model or corpus changed since baseline.

### `assertPerQueryFloors(delta, floors)`

Throws `DriftGateError("per-query-floor-failed")` if any query that previously had non-zero recall regresses below a per-query floor.

### `calibrateThresholds(reports)`

Given a history of reports, suggests conservative `maxRecallDrop` and `maxHitRateDrop` thresholds.

### `loadGoldenDataset(path)`

Loads and validates a golden dataset JSON file against the schema.

### Golden dataset schema

```json
[
  {
    "query": "how to create a table in postgres",
    "relevant_ids": ["doc-uuid-1", "doc-uuid-2"],
    "source": "user"
  }
]
```

`source` is `"user"` or `"synthetic"`. Only `query` and `relevant_ids` are required.

## Prior art

Recall@K, MRR, nDCG, and LLM-as-judge are standard retrieval evaluation techniques. [RAGAS](https://docs.ragas.io), [promptfoo](https://promptfoo.dev), and [DeepEval](https://docs.confident-ai.com) implement them well. This package focuses on a narrower goal: a deterministic, golden-dataset-driven CI gate that fails the build on regression, with typed failure kinds so pipelines can branch on why retrieval degraded.

## License

MIT
