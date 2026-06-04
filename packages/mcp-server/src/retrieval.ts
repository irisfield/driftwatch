// @deno-types="npm:@types/pg@^8.0.0"
import pg from "pg";

import type { QueryEmbedFn } from "./embed.ts";
import type { SearchResult } from "./types.ts";

const { Pool } = pg;

export type DbPool = InstanceType<typeof Pool>;

export function createPool(connectionString: string, max = 5): DbPool {
  return new Pool({ connectionString, max });
}

export async function closePool(pool: DbPool): Promise<void> {
  await pool.end();
}

const RETRIEVAL_SQL = `
  SELECT
    c.id             AS chunk_id,
    c.document_id    AS document_id,
    d.title          AS title,
    d.section_path   AS section_path,
    c.content        AS content,
    d.source_url     AS source_url,
    (c.embedding <=> $1::halfvec(1536)) AS score
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE ($3::text IS NULL OR d.corpus = $3)
  ORDER BY score ASC
  LIMIT $2
`;

interface RetrievalRow {
  chunk_id: string;
  document_id: string;
  title: string;
  section_path: string;
  content: string;
  source_url: string;
  score: number;
}

export async function searchDocs(
  pool: DbPool,
  embedFn: QueryEmbedFn,
  query: string,
  k: number,
  corpus?: string,
): Promise<SearchResult[]> {
  const embedding = await embedFn(query);
  if (embedding.length !== 1536) {
    throw new Error(
      `searchDocs: expected 1536-dimensional embedding, got ${String(embedding.length)}`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("SET hnsw.ef_search = 100");
    const result = await client.query<RetrievalRow>(RETRIEVAL_SQL, [
      JSON.stringify(embedding),
      k,
      corpus ?? null,
    ]);
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      title: row.title,
      sectionPath: row.section_path,
      content: row.content,
      sourceUrl: row.source_url,
      score: row.score,
    }));
  } finally {
    client.release();
  }
}

interface ExplainRow {
  "QUERY PLAN": string;
}

export async function assertHnswIndexUsed(pool: DbPool, embedding: number[]): Promise<void> {
  if (embedding.length !== 1536) {
    throw new Error(
      `assertHnswIndexUsed: expected 1536-dimensional embedding, got ${String(embedding.length)}`,
    );
  }

  // SET enable_seqscan = off forces the planner to use the index regardless of
  // table size, preventing false-positive failures on small/fresh CI databases.
  // Check for "Index Scan using" rather than the specific index name so the
  // assertion survives index renames without becoming a silent no-op.
  const client = await pool.connect();
  try {
    await client.query("SET enable_seqscan = off");
    const result = await client.query<ExplainRow>(
      "EXPLAIN SELECT c.id FROM chunks c ORDER BY c.embedding <=> $1::halfvec(1536) LIMIT 10",
      [JSON.stringify(embedding)],
    );
    const plan = result.rows.map((r) => r["QUERY PLAN"]).join("\n");

    if (!plan.includes("Index Scan using")) {
      throw new Error(
        `assertHnswIndexUsed: HNSW index not used in retrieval query. EXPLAIN output:\n${plan}`,
      );
    }
  } finally {
    client.release();
  }
}
