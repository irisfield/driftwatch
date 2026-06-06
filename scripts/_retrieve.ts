import pg from "pg";

import type { EmbedFn } from "../packages/ingest/src/embed.ts";
import { RETRIEVAL_SQL } from "../packages/mcp-server/src/retrieval.ts";

export function makeRetrieveFn(
  embedder: EmbedFn,
  pool: pg.Pool,
  corpus: string,
  k: number,
): (query: string) => Promise<string[]> {
  return async (query: string): Promise<string[]> => {
    const [embedding] = await embedder([query]);
    if (embedding === undefined) throw new Error("embedder returned no result");

    const client = await pool.connect();
    try {
      await client.query("SET hnsw.ef_search = 100");
      // Over-fetch by k×5: one document has N chunks, so k×5 rows guarantee k unique doc IDs
      // unless the corpus has fewer than k documents (degenerate case).
      const result = await client.query<{ document_id: string }>(RETRIEVAL_SQL, [
        JSON.stringify(embedding),
        k * 5,
        corpus,
      ]);
      const seen = new Set<string>();
      const docIds: string[] = [];
      for (const row of result.rows) {
        if (!seen.has(row.document_id)) {
          seen.add(row.document_id);
          docIds.push(row.document_id);
          if (docIds.length === k) break;
        }
      }
      return docIds;
    } finally {
      client.release();
    }
  };
}
