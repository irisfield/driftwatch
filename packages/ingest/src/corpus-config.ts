export interface CorpusConfig {
  name: string;
  sitemapUrl: string;
  embeddingModel: string;
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
};
