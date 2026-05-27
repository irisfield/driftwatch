# driftwatch

Retrieval regression testing for RAG systems. Define a golden dataset, run your retriever against it, and fail the build when quality drops.

---

## The problem

When a database query breaks, you get a 500 error. When retrieval degrades, you get a 200 with the wrong documents. The LLM still produces a fluent answer. Your dashboards stay green. You find out from users.

This happens after changes that look safe: swapping an embedding model, retuning chunk size, adjusting HNSW parameters. Recall drops silently. Nothing crashes.

---

## How it works

You supply a **golden dataset** — 30–50 query/correct-document pairs — and your **`retrieve()` function**. driftwatch runs your retriever against every golden query, computes rank metrics (Recall@K, MRR, nDCG), diffs the result against a committed baseline, and throws when retrieval has regressed past a configured threshold.

The gate is deterministic math — no LLM calls, no external services, no cost per CI run. An optional LLM-as-judge diagnostic is available separately and is always non-blocking.

```
golden dataset + retrieve()
         |
         v
   evaluate: Recall@K, MRR, nDCG
         |
         v
   diff against baseline-report.json  <-- committed to git
         |
         v
   Recall@5: 0.84 -> 0.61  (threshold: 0.05 drop)
         |
         v
   assertNoRegression throws  -->  CI fails, PR blocked
```

---

## Installation

```sh
bun add @irisfield/driftwatch
# npm install @irisfield/driftwatch
```

---

## Quick start

```ts
import { evaluateRetrieval, assertNoRegression, loadGoldenDataset } from "@irisfield/driftwatch";
import baseline from "./baseline-report.json";

const golden = await loadGoldenDataset("./golden/queries.json");

const report = await evaluateRetrieval({
  golden,
  retrieve: async (query) => {
    // your retrieval implementation — pgvector, Pinecone, Weaviate, anything
    return myVectorSearch(query, { topK: 5 });
  },
});

// throws if Recall@5 dropped more than 5% from baseline
assertNoRegression(report, baseline, { maxRecallDrop: 0.05 });
```

Add this to CI alongside your existing tests. When a change regresses retrieval, the build fails before it ships.

---

## Packages

**`@irisfield/driftwatch`**

The reusable library. Runtime-agnostic TypeScript — works with any retrieval stack. The `retrieve()` function is user-supplied, so the library has no opinion about your vector database, embedding model, or infrastructure.

Exports: `evaluateRetrieval`, `compareReports`, `assertRetrievalHealthy`, `assertNoRegression`, `judgeRelevance` (LLM-as-judge, optional).

**Reference MCP server**

A docs-RAG server on Supabase Edge Functions and pgvector, serving the Supabase and MCP documentation to agents. driftwatch enforces retrieval quality in CI before any change deploys. It is the library's reference integration — a real production-grade system with the gate wired in, not a toy demo.

---

## Why retrieval, not end-to-end quality

Retrieval and generation fail for different reasons. When you swap an embedding model, the LLM did not change — your retrieved context did. Evaluating the full pipeline conflates two separate failure modes and makes both harder to debug. driftwatch isolates retrieval so the signal is clean: this change, at this layer, caused recall to drop by this amount.

---

## Comparison

The metrics — Recall@K, MRR, nDCG — are standard information retrieval math, not novel. Frameworks like RAGAS, promptfoo, and DeepEval implement them too, and if you are in Python building a full eval platform, reach for one of those first.

driftwatch occupies a different position: a small, TypeScript-native library that does one job (retrieval regression testing in CI) and fits into a git-based workflow without external infrastructure.

|                  | driftwatch            | RAGAS / TruLens    | Braintrust / LangSmith |
| ---------------- | --------------------- | ------------------ | ---------------------- |
| Language         | TypeScript            | Python             | JS + Python            |
| Focus            | retrieval only        | full RAG stack     | full LLM lifecycle     |
| CI gate          | deterministic, native | possible but heavy | external SaaS          |
| Baseline storage | JSON committed to git | external           | external dashboard     |
| Cost per CI run  | none                  | LLM calls required | metered                |

---

## License

MIT
