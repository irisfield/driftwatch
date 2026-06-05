import { createHash } from "node:crypto";

export interface CorpusFingerprint {
  corpusHash: string;
  embeddingModel: string;
}

export function computeCorpusFingerprint(
  rows: readonly { documentId: string; contentHash: string }[],
  embeddingModel: string,
): CorpusFingerprint {
  const sorted = [...rows].toSorted((a, b) => a.documentId.localeCompare(b.documentId));
  const input = sorted.map((r) => `${r.documentId}:${r.contentHash}`).join("\n");
  const corpusHash = createHash("sha256").update(input).digest("hex");
  return { corpusHash, embeddingModel };
}
