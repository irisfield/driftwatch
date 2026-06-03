import pg from "pg";

import type { Chunk } from "./chunk.js";
import type { ScrapedDocument } from "./scrape.js";

const { Pool } = pg;

export type DbPool = InstanceType<typeof Pool>;

export function createPool(connectionString: string): DbPool {
  return new Pool({ connectionString, max: 5 });
}

export async function closePool(pool: DbPool): Promise<void> {
  await pool.end();
}

export async function selectOrInsertDocument(pool: DbPool, doc: ScrapedDocument): Promise<string> {
  // INSERT first to avoid a TOCTOU race; ON CONFLICT DO NOTHING lets concurrent
  // workers land on the same document without duplicating rows.
  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO documents (source_url, title, section_path, raw_text, corpus, embedding_model)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_url, section_path) DO NOTHING
     RETURNING id`,
    [doc.sourceUrl, doc.title, doc.sectionPath, doc.rawText, doc.corpus, doc.embeddingModel],
  );

  if ((insertResult.rowCount ?? 0) > 0) {
    const row = insertResult.rows[0];
    if (row === undefined) {
      throw new Error("selectOrInsertDocument: INSERT returned no rows");
    }
    return row.id;
  }

  // Row already existed; fetch its id.
  const selectResult = await pool.query<{ id: string }>(
    "SELECT id FROM documents WHERE source_url = $1 AND section_path = $2",
    [doc.sourceUrl, doc.sectionPath],
  );

  const row = selectResult.rows[0];
  if (row === undefined) {
    throw new Error("selectOrInsertDocument: document not found after conflict");
  }
  return row.id;
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
  embeddingModel: string;
}

// Batch upsert via unnest — one round-trip regardless of chunk count.
// ON CONFLICT (document_id, content_hash) scopes dedup per document so
// identical text shared across different documents gets its own chunk rows
// and is visible to corpus-filtered retrieval in both.
const BATCH_UPSERT_SQL = `
  INSERT INTO chunks (document_id, chunk_index, content, token_count, content_hash, embedding, embedding_model)
  SELECT $1, t.ci, t.ct, t.tc, t.ch, t.em::halfvec(1536), t.emod
  FROM unnest($2::int[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[])
    AS t(ci, ct, tc, ch, em, emod)
  ON CONFLICT (document_id, content_hash) DO NOTHING
  RETURNING id
`;

export async function upsertChunks(
  pool: DbPool,
  documentId: string,
  chunks: ChunkWithEmbedding[],
): Promise<{ inserted: number; skipped: number }> {
  if (chunks.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  for (const chunk of chunks) {
    if (chunk.embedding.length !== 1536) {
      throw new Error(
        `upsertChunks: expected 1536-dimensional embedding, got ${String(chunk.embedding.length)} for chunk ${String(chunk.chunkIndex)}`,
      );
    }
  }

  const result = await pool.query<{ id: string }>(BATCH_UPSERT_SQL, [
    documentId,
    chunks.map((c) => c.chunkIndex),
    chunks.map((c) => c.content),
    chunks.map((c) => c.tokenCount),
    chunks.map((c) => c.contentHash),
    chunks.map((c) => JSON.stringify(c.embedding)),
    chunks.map((c) => c.embeddingModel),
  ]);

  const inserted = result.rowCount ?? 0;
  const skipped = chunks.length - inserted;

  // Remove stale tail chunks left from a prior ingest that produced more chunks.
  // Only runs when at least one chunk was inserted so pure cache-hit re-ingests
  // skip this DELETE entirely.
  if (inserted > 0) {
    const maxIndex = chunks.reduce((m, c) => Math.max(m, c.chunkIndex), 0);
    await pool.query("DELETE FROM chunks WHERE document_id = $1 AND chunk_index > $2", [
      documentId,
      maxIndex,
    ]);
  }

  return { inserted, skipped };
}
