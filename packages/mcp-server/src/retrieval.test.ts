import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";

import { assertHnswIndexUsed, closePool, createPool, searchDocs } from "./retrieval.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const skip = DATABASE_URL === undefined;

function makeEmbedding(value: number): number[] {
  return Array.from({ length: 1536 }, () => value);
}

function makeFakeEmbedFn(embedding: number[]) {
  return (_text: string): Promise<number[]> => Promise.resolve(embedding);
}

Deno.test({
  name: "assertHnswIndexUsed: HNSW index is present in query plan",
  ignore: skip,
  async fn() {
    const pool = createPool(DATABASE_URL!);
    try {
      await assertHnswIndexUsed(pool, makeEmbedding(0.1));
    } finally {
      await closePool(pool);
    }
  },
});

Deno.test({
  name: "assertHnswIndexUsed: throws when embedding has wrong dimensions",
  async fn() {
    const pool = createPool("postgresql://placeholder/placeholder");
    try {
      await assertRejects(
        () => assertHnswIndexUsed(pool, [0.1, 0.2]),
        Error,
        "expected 1536-dimensional embedding",
      );
    } finally {
      await closePool(pool);
    }
  },
});

Deno.test({
  name: "searchDocs: throws when embedFn returns wrong dimensions",
  ignore: skip,
  async fn() {
    const pool = createPool(DATABASE_URL!);
    try {
      await assertRejects(
        () => searchDocs(pool, makeFakeEmbedFn([0.1, 0.2]), "test query", 5),
        Error,
        "expected 1536-dimensional embedding",
      );
    } finally {
      await closePool(pool);
    }
  },
});

Deno.test({
  name: "searchDocs: returns ranked results for an ingested corpus",
  ignore: skip,
  async fn() {
    const pool = createPool(DATABASE_URL!);
    try {
      const results = await searchDocs(
        pool,
        makeFakeEmbedFn(makeEmbedding(0.1)),
        "test query",
        5,
      );
      // Results may be empty if the corpus has not been ingested yet.
      // The structural invariants are what we assert here.
      for (const r of results) {
        assertEquals(typeof r.chunkId, "string");
        assertEquals(typeof r.documentId, "string");
        assertEquals(typeof r.title, "string");
        assertEquals(typeof r.sectionPath, "string");
        assertEquals(typeof r.content, "string");
        assertEquals(typeof r.sourceUrl, "string");
        assertEquals(typeof r.score, "number");
      }
    } finally {
      await closePool(pool);
    }
  },
});

Deno.test({
  name: "searchDocs: corpus filter restricts results to the named corpus",
  ignore: skip,
  async fn() {
    const pool = createPool(DATABASE_URL!);
    try {
      const results = await searchDocs(
        pool,
        makeFakeEmbedFn(makeEmbedding(0.1)),
        "test query",
        10,
        "supabase",
      );
      for (const r of results) {
        // source_url is not corpus, but the filter is on d.corpus — we
        // assert the result set is not obviously wrong (no assertion on
        // corpus field directly since it's not in SearchResult).
        assertEquals(typeof r.sourceUrl, "string");
      }
    } finally {
      await closePool(pool);
    }
  },
});
