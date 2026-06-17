# driftwatch

When retrieval degrades, the LLM still answers fluently, dashboards stay green, and you find out from users. driftwatch measures Recall@K, MRR, nDCG, and HitRate against a golden dataset and fails the CI build when results regress past a committed baseline. A reference MCP server on Supabase Edge Functions and pgvector demonstrates the library on a live corpus of Supabase and PostgreSQL documentation.

---

## Install

```bash
npm install @irisfield/driftwatch
# or
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

## MCP client setup

The reference MCP server is deployed as a Supabase Edge Function. To connect Claude Code, add the following to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "driftwatch": {
      "type": "http",
      "url": "https://<your-project>.supabase.co/functions/v1/driftwatch"
    }
  }
}
```

For Cursor: _(Configuration path pending verification against a real Cursor install.)_

The server exposes three tools:

- `search_docs(query, k?, corpus?)` — returns ranked chunks with source URLs
- `get_document(document_id)` — returns full document text
- `list_corpora()` — returns available corpora and last ingest time

The function is unauthenticated. See Known Limitations below.

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
| Second corpus (PostgreSQL docs) | In progress |
| Authentication on the Edge Function | Roadmap |
| Hosted public demo | Roadmap |
| Embedding-swap study | Roadmap |

---

## Known limitations

- The Edge Function is unauthenticated. Supabase MCP-on-Edge authentication is not yet available. Anyone with the URL can call the tools.
- This release uses a single embedding model: `gemini-embedding-001` at 1536 dimensions.
- The ingest CLI is an offline Node/Bun tool. The Edge Function does not ingest documents.
- The golden dataset requires manual validation. The bootstrap script drafts candidate pairs; a human must validate each one before committing.

---

## Contributing

Issues are triaged weekly. Pull requests are welcome. Breaking changes require a major version bump. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and release process.
