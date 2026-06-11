export interface CorpusConfig {
  name: string;
  sitemapUrl: string;
  embeddingModel: string;
  /** Substring filter applied to sitemap URLs. Defaults to "/docs" if omitted. */
  sitemapPathFilter?: string;
  /** CSS selector for the main content element. Falls back to main/article/body if omitted. */
  contentSelector?: string;
}

export const CORPORA: Record<string, CorpusConfig> = {
  supabase: {
    name: "supabase",
    sitemapUrl: "https://supabase.com/docs/sitemap.xml",
    embeddingModel: "text-embedding-3-small",
  },
  mcp: {
    name: "mcp",
    sitemapUrl: "https://modelcontextprotocol.io/sitemap.xml",
    embeddingModel: "text-embedding-3-small",
  },
  postgres: {
    name: "postgres",
    sitemapUrl: "https://www.postgresql.org/sitemap.xml",
    embeddingModel: "text-embedding-3-small",
    // Pinned to PG 18 (current stable) for corpus stability. /docs/19/ is the
    // in-development "devel" branch and changes too frequently for a golden set.
    sitemapPathFilter: "/docs/18/",
    contentSelector: "#docContent",
  },
};
