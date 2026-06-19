export interface CorpusConfig {
  name: string;
  sitemapUrl: string;
  embeddingModel: string;
  /** Substring filter applied to sitemap URLs. Defaults to "/docs" if omitted. */
  sitemapPathFilter?: string;
  /** CSS selector for the main content element. Falls back to main/article/body if omitted. */
  contentSelector?: string;
  /**
   * Exact URL list to ingest, used instead of a live sitemap fetch + --limit slice.
   * A live sitemap's <loc> order is not guaranteed stable across fetches (confirmed:
   * postgresql.org's returned a different first-30 page set on a later run), so any
   * corpus with a committed golden dataset must pin its exact pages here to guarantee
   * CI re-ingests the same documents the golden queries were written against.
   */
  pinnedUrls?: string[];
}

export const CORPORA: Record<string, CorpusConfig> = {
  supabase: {
    name: "supabase",
    sitemapUrl: "https://supabase.com/docs/sitemap.xml",
    embeddingModel: "gemini-embedding-001",
    pinnedUrls: [
      "https://supabase.com/docs/guides/ai-tools",
      "https://supabase.com/docs/guides/ai",
      "https://supabase.com/docs/guides/api",
      "https://supabase.com/docs/guides/auth",
      "https://supabase.com/docs/guides/cli",
      "https://supabase.com/docs/guides/ai/langchain",
      "https://supabase.com/docs/guides/cron",
      "https://supabase.com/docs/guides/deployment",
      "https://supabase.com/docs/guides/functions",
      "https://supabase.com/docs/guides/getting-started",
      "https://supabase.com/docs/guides/integrations",
      "https://supabase.com/docs/guides/local-development",
      "https://supabase.com/docs/guides/platform",
      "https://supabase.com/docs/guides/ai/python-clients",
      "https://supabase.com/docs/guides/queues",
      "https://supabase.com/docs/guides/realtime",
      "https://supabase.com/docs/guides/resources",
      "https://supabase.com/docs/guides/security",
      "https://supabase.com/docs/guides/self-hosting",
      "https://supabase.com/docs/guides/storage",
      "https://supabase.com/docs/guides/telemetry",
      "https://supabase.com/docs/guides/ai/automatic-embeddings",
      "https://supabase.com/docs/guides/ai/choosing-compute-addon",
      "https://supabase.com/docs/guides/ai/concepts",
      "https://supabase.com/docs/guides/ai/engineering-for-scale",
      "https://supabase.com/docs/guides/ai/going-to-prod",
      "https://supabase.com/docs/guides/ai/google-colab",
      "https://supabase.com/docs/guides/ai/hugging-face",
      "https://supabase.com/docs/guides/ai/hybrid-search",
      "https://supabase.com/docs/guides/ai/keyword-search",
    ],
  },
  mcp: {
    name: "mcp",
    sitemapUrl: "https://modelcontextprotocol.io/sitemap.xml",
    embeddingModel: "gemini-embedding-001",
  },
  postgres: {
    name: "postgres",
    sitemapUrl: "https://www.postgresql.org/sitemap.xml",
    embeddingModel: "gemini-embedding-001",
    // Pinned to PG 18 (current stable) for corpus stability. /docs/19/ is the
    // in-development "devel" branch and changes too frequently for a golden set.
    sitemapPathFilter: "/docs/18/",
    contentSelector: "#docContent",
    pinnedUrls: [
      "https://www.postgresql.org/docs/18/fdw-planning.html",
      "https://www.postgresql.org/docs/18/infoschema-element-types.html",
      "https://www.postgresql.org/docs/18/tutorial-sql.html",
      "https://www.postgresql.org/docs/18/sql-createforeigntable.html",
      "https://www.postgresql.org/docs/18/release-18-1.html",
      "https://www.postgresql.org/docs/18/sql-dropusermapping.html",
      "https://www.postgresql.org/docs/18/sql-creatematerializedview.html",
      "https://www.postgresql.org/docs/18/pltcl-overview.html",
      "https://www.postgresql.org/docs/18/default-roles.html",
      "https://www.postgresql.org/docs/18/datatype-oid.html",
      "https://www.postgresql.org/docs/18/datetime-invalid-input.html",
      "https://www.postgresql.org/docs/18/pgoverexplain.html",
      "https://www.postgresql.org/docs/18/fdw-callbacks.html",
      "https://www.postgresql.org/docs/18/plpython-subtransaction.html",
      "https://www.postgresql.org/docs/18/plpgsql-control-structures.html",
      "https://www.postgresql.org/docs/18/view-pg-publication-tables.html",
      "https://www.postgresql.org/docs/18/plpgsql-statements.html",
      "https://www.postgresql.org/docs/18/upgrading.html",
      "https://www.postgresql.org/docs/18/tutorial-transactions.html",
      "https://www.postgresql.org/docs/18/catalog-pg-opfamily.html",
      "https://www.postgresql.org/docs/18/spi-spi-gettype.html",
      "https://www.postgresql.org/docs/18/catalogs-overview.html",
      "https://www.postgresql.org/docs/18/geqo-biblio.html",
      "https://www.postgresql.org/docs/18/backup-manifest-toplevel.html",
      "https://www.postgresql.org/docs/18/sql-merge.html",
      "https://www.postgresql.org/docs/18/btree-gist.html",
      "https://www.postgresql.org/docs/18/app-initdb.html",
      "https://www.postgresql.org/docs/18/contrib-dblink-exec.html",
      "https://www.postgresql.org/docs/18/spi-spi-execute-plan-extended.html",
      "https://www.postgresql.org/docs/18/rowtypes.html",
    ],
  },
};
