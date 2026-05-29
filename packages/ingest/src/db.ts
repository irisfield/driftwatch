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
  const selectResult = await pool.query<{ id: string }>(
    "SELECT id FROM documents WHERE source_url = $1 AND section_path = $2",
    [doc.sourceUrl, doc.sectionPath],
  );

  if ((selectResult.rowCount ?? 0) > 0) {
    const row = selectResult.rows[0];
    if (row === undefined) {
      throw new Error("selectOrInsertDocument: unexpected undefined row after rowCount check");
    }
    return row.id;
  }

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO documents (source_url, title, section_path, raw_text, corpus, embedding_model)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [doc.sourceUrl, doc.title, doc.sectionPath, doc.rawText, doc.corpus, doc.embeddingModel],
  );

  const row = insertResult.rows[0];
  if (row === undefined) {
    throw new Error("selectOrInsertDocument: INSERT returned no rows");
  }
  return row.id;
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
  embeddingModel: string;
}

export async function upsertChunks(
  pool: DbPool,
  documentId: string,
  chunks: ChunkWithEmbedding[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    if (chunk.embedding.length !== 1536) {
      throw new Error(
        `upsertChunks: expected 1536-dimensional embedding, got ${String(chunk.embedding.length)} for chunk ${String(chunk.chunkIndex)}`,
      );
    }

    const result = await pool.query(
      `INSERT INTO chunks (document_id, chunk_index, content, token_count, content_hash, embedding, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6::halfvec(1536), $7)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        documentId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenCount,
        chunk.contentHash,
        JSON.stringify(chunk.embedding),
        chunk.embeddingModel,
      ],
    );

    if ((result.rowCount ?? 0) > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  if (chunks.length > 0) {
    const maxIndex = chunks.reduce((m, c) => Math.max(m, c.chunkIndex), 0);
    await pool.query("DELETE FROM chunks WHERE document_id = $1 AND chunk_index > $2", [
      documentId,
      maxIndex,
    ]);
  }

  return { inserted, skipped };
}
