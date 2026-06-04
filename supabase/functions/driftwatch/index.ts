import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { z } from "zod";

import { createPool, searchDocs } from "../../../packages/mcp-server/src/retrieval.ts";
import { createQueryEmbedder } from "../../../packages/mcp-server/src/embed.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-3-small";

if (!DATABASE_URL) throw new Error("DATABASE_URL environment variable is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY environment variable is required");

// max:2 — Edge Functions run in isolated Deno processes; each cold start creates
// a new Pool. Keeping the ceiling low limits connection accumulation on Postgres
// when many isolates are alive simultaneously. Route through Supavisor
// (transaction mode) in production to eliminate the per-isolate leak entirely.
const pool = createPool(DATABASE_URL, 2);
const embedFn = createQueryEmbedder(OPENAI_API_KEY, EMBEDDING_MODEL);

// Characters beyond this limit are truncated in get_document responses to stay
// well under the Edge Function 6 MB response size ceiling.
const MAX_RAW_TEXT_CHARS = 50_000;

interface DocumentRow {
  id: string;
  source_url: string;
  title: string;
  section_path: string;
  raw_text: string;
  corpus: string;
  embedding_model: string;
  ingested_at: Date;
}

interface CorpusRow {
  corpus: string;
  embedding_model: string;
  last_ingested_at: Date;
}

function textBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

function toolError(
  toolName: string,
  error: unknown,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [textBlock(`${toolName} error: ${message}`)], isError: true };
}

const mcp = new McpServer({
  name: "driftwatch",
  version: "1.0.0",
  schemaAdapter: (schema) => {
    if (!(schema instanceof z.ZodType)) {
      throw new Error("driftwatch MCP: expected Zod schema in schemaAdapter");
    }
    return z.toJSONSchema(schema);
  },
});

mcp.tool("search_docs", {
  description: "Search the documentation corpus for chunks relevant to a natural-language query. " +
    "Returns ranked results with citations (title, source URL, section, content, similarity score).",
  inputSchema: z.object({
    query: z.string().describe("Natural-language search query"),
    k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of results to return (default 5)"),
    corpus: z
      .string()
      .optional()
      .describe("Restrict search to a specific corpus (e.g. 'supabase', 'mcp')"),
  }),
  handler: async (args: { query: string; k?: number; corpus?: string }) => {
    try {
      const results = await searchDocs(pool, embedFn, args.query, args.k ?? 5, args.corpus);
      return { content: [textBlock(JSON.stringify(results, null, 2))] };
    } catch (error) {
      return toolError("search_docs", error);
    }
  },
});

mcp.tool("get_document", {
  description: "Retrieve a full document by its UUID, including raw text and metadata.",
  inputSchema: z.object({
    document_id: z.string().uuid().describe("UUID of the document to retrieve"),
  }),
  handler: async (args: { document_id: string }) => {
    try {
      const result = await pool.query<DocumentRow>(
        `SELECT id, source_url, title, section_path, raw_text, corpus, embedding_model, ingested_at
         FROM documents WHERE id = $1`,
        [args.document_id],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return {
          content: [textBlock(`get_document: no document found with id ${args.document_id}`)],
          isError: true,
        };
      }
      if (row.raw_text.length > MAX_RAW_TEXT_CHARS) {
        row.raw_text = row.raw_text.slice(0, MAX_RAW_TEXT_CHARS) +
          `\n[truncated at ${String(MAX_RAW_TEXT_CHARS)} characters]`;
      }
      return { content: [textBlock(JSON.stringify(row, null, 2))] };
    } catch (error) {
      return toolError("get_document", error);
    }
  },
});

mcp.tool("list_corpora", {
  description:
    "List all available documentation corpora with their embedding model and last ingest time.",
  inputSchema: z.object({}),
  handler: async (_args: Record<string, never>) => {
    try {
      const result = await pool.query<CorpusRow>(
        `SELECT corpus, embedding_model, MAX(ingested_at) AS last_ingested_at
         FROM documents
         GROUP BY corpus, embedding_model
         ORDER BY corpus`,
      );
      return { content: [textBlock(JSON.stringify(result.rows, null, 2))] };
    } catch (error) {
      return toolError("list_corpora", error);
    }
  },
});

const transport = new StreamableHttpTransport();
const handler = transport.bind(mcp);

export default { fetch: handler };
