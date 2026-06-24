# driftwatch

When retrieval degrades, the LLM still answers fluently, dashboards stay green, and you find out from users. driftwatch measures Recall@K, MRR, nDCG, and HitRate against a golden dataset and fails the CI build when results regress past a committed baseline. A reference MCP server on Supabase Edge Functions and pgvector demonstrates the library on a live corpus of Supabase and PostgreSQL documentation.

---

## Why this exists

You swap an embedding model, change a chunking strategy, or re-rank results, and nothing visibly breaks: the LLM still answers fluently because it's good at sounding confident even when the retrieved context is wrong or missing. Dashboards stay green because they track latency and error rates, not whether the *right* document came back. Weeks later a user notices the assistant is citing the wrong section, or the answer to an obvious question is suddenly vague, and by then nobody remembers which deploy caused it.

driftwatch closes that gap the same way a test suite closes the gap for application logic: it runs your retriever against a fixed set of query → correct-document pairs on every PR, computes rank metrics, and fails the build the moment those metrics drop past a committed baseline. See "[What a regression looks like](#what-a-regression-looks-like)" below for the actual failure output.

---

## Install

```bash
deno add jsr:@irisfield/driftwatch
```

---

## Quickstart

```typescript
import { evaluateRetrieval, assertRetrievalHealthy, loadGoldenDataset } from "@irisfield/driftwatch";

const golden = await loadGoldenDataset("golden/my-corpus.json");

const report = await evaluateRetrieval({
  golden,
  retrieve: async (query) => {
    // Return a ranked array of document IDs, most relevant first.
    return myVectorSearch(query);
  },
  k: 5,
});

assertRetrievalHealthy(report, { minRecallAtK: 0.7, minMrr: 0.6 });
```

`assertRetrievalHealthy` throws a `DriftGateError` when metrics fall below the configured thresholds. To diff against a committed baseline instead of fixed thresholds, use `assertNoRegression(compareReports(baseline, report), thresholds)`.

---

## What a regression looks like

Real output from `assertNoRegression` after simulating an embedding-model swap that quietly hurt retrieval quality:

```
Retrieval regression detected:
  recallAtK dropped 0.2300 (limit: 0.0500) — before: 0.9400, after: 0.7100
  hitRate dropped 0.1800 (limit: 0.0500) — before: 0.9700, after: 0.7900
Golden set: 2 queries (1 user, 1 synthetic)
```

The thrown `DriftGateError` carries a typed `kind` (`"retriever-regressed"` here) so CI can branch on *why* it failed, not just that it failed.

---

## MCP client setup

The reference MCP server runs as a Supabase Edge Function, but there is no shared hosted instance — you deploy your own Supabase project, ingest a corpus, and connect to that. See [CONTRIBUTING.md](CONTRIBUTING.md) for the deploy steps (project link, schema push, secrets, ingest, function deploy).

Once deployed, the function is gated by Supabase's platform-level JWT check (`verify_jwt`, on by default): any request without a valid project JWT gets a 401 before it reaches the function. To connect Claude Code, add the following to `.claude/settings.json`, using your project's anon key as the bearer token:

```json
{
  "mcpServers": {
    "driftwatch": {
      "type": "http",
      "url": "https://<your-project>.supabase.co/functions/v1/driftwatch",
      "headers": {
        "Authorization": "Bearer <your-project-anon-key>"
      }
    }
  }
}
```

For Cursor: _(Configuration path pending verification against a real Cursor install.)_

The server exposes three tools:

- `search_docs(query, k?, corpus?)` — returns ranked chunks with source URLs
- `get_document(document_id)` — returns full document text
- `list_corpora()` — returns available corpora and last ingest time

This is request-level gating only — anyone with your anon key can call all three tools with no finer-grained authorization inside the function itself. See Known Limitations below.

---

## Prior art

Recall@K, MRR, nDCG, and LLM-as-judge are standard retrieval evaluation techniques. [RAGAS](https://docs.ragas.io), [promptfoo](https://promptfoo.dev), and [DeepEval](https://docs.confident-ai.com) implement them well. The contribution here is different: a CI-gated, golden-dataset-driven harness wired into a real MCP server on Supabase pgvector, packaged so any team can drop it into their own retrieval system and fail the build on regression.

---

## Shipped vs roadmap

| Feature | Status |
|---|---|
| Recall@K, MRR, nDCG, HitRate, Precision@K metrics | Shipped |
| Golden dataset schema, loader, validator | Shipped |
| `evaluateRetrieval`, `compareReports`, `assertNoRegression` | Shipped |
| LLM-as-judge (non-blocking, cached, temp 0) | Shipped |
| Reference MCP server (`search_docs`, `get_document`, `list_corpora`) | Shipped |
| pgvector HNSW retrieval with `halfvec(1536)` | Shipped |
| CI gate (GitHub Actions, pgvector service container) | Shipped |
| Second corpus (PostgreSQL docs) | Shipped |
| Edge Function gated by Supabase JWT auth (legacy anon/service key) | Shipped |
| Fine-grained Edge Function authorization (publishable/secret keys, in-function checks) | Roadmap |
| Hosted public demo | Roadmap |
| Embedding-swap study | Roadmap |

---

## Known limitations

- Authorization is platform-level only: Supabase's `verify_jwt` check rejects requests without a valid project JWT, but the function itself does no further authorization. Anyone with your anon key can call all three tools, with no per-user or per-corpus restriction.
- There is no shared hosted instance. Trying this out means deploying your own Supabase project (see CONTRIBUTING.md).
- This release uses a single embedding model: `gemini-embedding-001` at 1536 dimensions.
- The ingest CLI is an offline Node/Bun tool. The Edge Function does not ingest documents.
- The golden dataset requires manual validation. The bootstrap script drafts candidate pairs; a human must validate each one before committing.

---

## Contributing

Issues are triaged weekly. Pull requests are welcome. Breaking changes require a major version bump. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and release process.
