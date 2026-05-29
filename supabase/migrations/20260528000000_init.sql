CREATE EXTENSION IF NOT EXISTS vector;

-- Documents: one row per scraped page or section anchor.
CREATE TABLE IF NOT EXISTS documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      text        NOT NULL,
  title           text        NOT NULL,
  section_path    text        NOT NULL DEFAULT '',
  raw_text        text        NOT NULL,
  corpus          text        NOT NULL,
  embedding_model text        NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

-- Chunks: token-sized fragments, each carrying its own halfvec embedding.
-- content_hash is SHA-256 hex of content; the ingest CLI uses it for
-- idempotent upserts (skip re-embedding when content has not changed).
-- UNIQUE (content_hash) enforces the idempotency invariant at the DB level
-- so concurrent ingest workers cannot insert duplicate chunks.
CREATE TABLE IF NOT EXISTS chunks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index     integer     NOT NULL,
  content         text        NOT NULL,
  token_count     integer     NOT NULL,
  content_hash    text        NOT NULL,
  embedding       halfvec(1536) NOT NULL,
  embedding_model text        NOT NULL,

  CONSTRAINT chunks_document_chunk_unique UNIQUE (document_id, chunk_index),
  CONSTRAINT chunks_content_hash_unique   UNIQUE (content_hash)
);

-- HNSW index for approximate nearest-neighbour search.
-- halfvec_cosine_ops matches cosine similarity (<=>).
-- m=16, ef_construction=64 per project plan defaults.
--
-- INVARIANT: every retrieval query MUST cast the query vector explicitly:
--   embedding <=> $1::halfvec(1536)
-- Omitting the cast bypasses this index and forces a sequential scan.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks
  USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ef_search controls how many candidates are explored per HNSW query.
-- Default is 40; project plan targets 100 for higher recall.
-- Set at database level so all connections inherit it without per-query SET.
ALTER DATABASE postgres SET hnsw.ef_search = 100;

-- Corpus snapshots: pins a corpus + model combination so CI can reproduce
-- a deterministic retrieval environment and re-baseline on intentional changes.
CREATE TABLE IF NOT EXISTS corpus_snapshots (
  snapshot_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus          text        NOT NULL,
  embedding_model text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
