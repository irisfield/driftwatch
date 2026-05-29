import { createHash } from "node:crypto";

import { decode, encode } from "gpt-tokenizer";

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

export interface Chunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  contentHash: string;
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function chunkDocument(rawText: string): Chunk[] {
  const tokens = encode(rawText);
  const chunks: Chunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < tokens.length) {
    const end = Math.min(start + CHUNK_SIZE, tokens.length);
    const windowTokens = tokens.slice(start, end);
    const content = decode(windowTokens).trim();

    if (content.length > 0) {
      chunks.push({
        chunkIndex,
        content,
        tokenCount: windowTokens.length,
        contentHash: sha256hex(content),
      });
      chunkIndex++;
    }

    if (end === tokens.length) {
      break;
    }
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}
