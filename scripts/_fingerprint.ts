import pg from "pg";

import {
  computeCorpusFingerprint,
  type CorpusFingerprint,
} from "../packages/eval-core/src/fingerprint.ts";

export async function fetchCorpusFingerprint(
  pool: pg.Pool,
  corpus: string,
): Promise<CorpusFingerprint> {
  const hashRows = await pool.query<{ document_id: string; content_hash: string }>(
    `SELECT d.id AS document_id, c.content_hash
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.corpus = $1`,
    [corpus],
  );

  const modelRows = await pool.query<{ embedding_model: string }>(
    "SELECT DISTINCT embedding_model FROM documents WHERE corpus = $1",
    [corpus],
  );

  if (modelRows.rows.length > 1) {
    throw new Error(
      `Corpus "${corpus}" has mixed embedding models: ` +
        modelRows.rows.map((r) => r.embedding_model).join(", "),
    );
  }

  const embeddingModel = modelRows.rows[0]?.embedding_model ?? "unknown";
  return computeCorpusFingerprint(
    hashRows.rows.map((r) => ({ documentId: r.document_id, contentHash: r.content_hash })),
    embeddingModel,
  );
}
