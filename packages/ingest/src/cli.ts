import { chunkDocument } from "./chunk.js";
import { CORPORA } from "./corpus-config.js";
import { closePool, createPool, selectOrInsertDocument, upsertChunks } from "./db.js";
import { createCachedEmbedder, createOpenAIEmbedder } from "./embed.js";
import { fetchDocument, fetchSitemap } from "./scrape.js";

import type { ChunkWithEmbedding } from "./db.js";

interface CliOptions {
  corpus: string;
  databaseUrl: string;
  openaiKey: string;
  limit: number;
  dryRun: boolean;
  cacheDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let corpus = "both";
  let databaseUrl = process.env.DATABASE_URL ?? "";
  let openaiKey = process.env.OPENAI_API_KEY ?? "";
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  let cacheDir = ".driftwatch-cache/embeddings";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--corpus" && next !== undefined) {
      corpus = next;
      i++;
    } else if (arg === "--database-url" && next !== undefined) {
      databaseUrl = next;
      i++;
    } else if (arg === "--openai-key" && next !== undefined) {
      openaiKey = next;
      i++;
    } else if (arg === "--limit" && next !== undefined) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        throw new Error(`--limit must be a positive integer, got "${next}"`);
      }
      limit = parsed;
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--cache-dir" && next !== undefined) {
      cacheDir = next;
      i++;
    }
  }

  return { corpus, databaseUrl, openaiKey, limit, dryRun, cacheDir };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (!opts.dryRun && opts.databaseUrl === "") {
    throw new Error("--database-url or DATABASE_URL is required");
  }
  if (!opts.dryRun && opts.openaiKey === "") {
    throw new Error("--openai-key or OPENAI_API_KEY is required");
  }

  const selectedCorpusNames = opts.corpus === "both" ? Object.keys(CORPORA) : [opts.corpus];

  for (const name of selectedCorpusNames) {
    if (!(name in CORPORA)) {
      throw new Error(`unknown corpus "${name}". Valid: ${Object.keys(CORPORA).join(", ")}`);
    }
  }

  const pool = opts.dryRun ? null : createPool(opts.databaseUrl);
  const baseEmbedder = opts.dryRun
    ? null
    : createOpenAIEmbedder(opts.openaiKey, "text-embedding-3-small");
  const embedder =
    opts.dryRun || baseEmbedder === null ? null : createCachedEmbedder(baseEmbedder, opts.cacheDir);

  let totalDocs = 0;
  let totalChunksInserted = 0;
  let totalChunksSkipped = 0;

  for (const name of selectedCorpusNames) {
    const corpusConfig = CORPORA[name];
    if (corpusConfig === undefined) continue;

    console.log(`\nFetching sitemap for corpus: ${name}`);
    const allUrls = await fetchSitemap(corpusConfig.sitemapUrl);
    const urls = allUrls.slice(0, opts.limit);
    console.log(`  ${String(urls.length)} URLs to process`);

    for (const url of urls) {
      await sleep(200);

      const doc = await fetchDocument(url, corpusConfig);
      if (doc === undefined) {
        console.log(`  [skip] ${url}`);
        continue;
      }

      const chunks = chunkDocument(doc.rawText);
      process.stdout.write(`  [${name}] ${url} → ${String(chunks.length)} chunks`);

      if (opts.dryRun || embedder === null || pool === null) {
        process.stdout.write(" (dry-run)\n");
        totalDocs++;
        continue;
      }

      const texts = chunks.map((c) => c.content);
      const embeddings = await embedder(texts);

      const chunksWithEmbedding: ChunkWithEmbedding[] = chunks.map((chunk, i) => {
        const embedding = embeddings[i];
        if (embedding === undefined) {
          throw new Error(`Missing embedding for chunk ${String(i)} of ${url}`);
        }
        return { ...chunk, embedding, embeddingModel: corpusConfig.embeddingModel };
      });

      const documentId = await selectOrInsertDocument(pool, doc);
      const { inserted, skipped } = await upsertChunks(pool, documentId, chunksWithEmbedding);

      process.stdout.write(` (${String(inserted)} inserted, ${String(skipped)} skipped)\n`);
      totalDocs++;
      totalChunksInserted += inserted;
      totalChunksSkipped += skipped;
    }
  }

  if (pool !== null) {
    await closePool(pool);
  }

  console.log(
    `\nDone. ${String(totalDocs)} documents, ${String(totalChunksInserted)} chunks inserted, ${String(totalChunksSkipped)} chunks skipped (cached/duplicate).`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
