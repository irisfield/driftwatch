import { describe, expect, it } from "vitest";

import { computeCorpusFingerprint } from "../src/fingerprint.js";

const rowA = { documentId: "550e8400-e29b-41d4-a716-446655440000", contentHash: "abc123" };
const rowB = { documentId: "550e8400-e29b-41d4-a716-446655440001", contentHash: "def456" };

describe("computeCorpusFingerprint", () => {
  it("returns a 64-character hex corpusHash", () => {
    const { corpusHash } = computeCorpusFingerprint([rowA], "text-embedding-3-small");
    expect(corpusHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces same output", () => {
    const fp1 = computeCorpusFingerprint([rowA, rowB], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint([rowA, rowB], "text-embedding-3-small");
    expect(fp1.corpusHash).toBe(fp2.corpusHash);
  });

  it("is order-independent — row order does not change the hash", () => {
    const fp1 = computeCorpusFingerprint([rowA, rowB], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint([rowB, rowA], "text-embedding-3-small");
    expect(fp1.corpusHash).toBe(fp2.corpusHash);
  });

  it("changes hash when a document is added", () => {
    const fp1 = computeCorpusFingerprint([rowA], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint([rowA, rowB], "text-embedding-3-small");
    expect(fp1.corpusHash).not.toBe(fp2.corpusHash);
  });

  it("changes hash when a document is removed", () => {
    const fp1 = computeCorpusFingerprint([rowA, rowB], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint([rowA], "text-embedding-3-small");
    expect(fp1.corpusHash).not.toBe(fp2.corpusHash);
  });

  it("changes hash when a document's contentHash changes", () => {
    const fp1 = computeCorpusFingerprint([rowA], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint(
      [{ documentId: rowA.documentId, contentHash: "edited-content" }],
      "text-embedding-3-small",
    );
    expect(fp1.corpusHash).not.toBe(fp2.corpusHash);
  });

  it("passes embeddingModel through unchanged", () => {
    const { embeddingModel } = computeCorpusFingerprint([rowA], "text-embedding-3-large");
    expect(embeddingModel).toBe("text-embedding-3-large");
  });

  it("different embeddingModel produces different CorpusFingerprint — different field, not corpusHash", () => {
    const fp1 = computeCorpusFingerprint([rowA], "text-embedding-3-small");
    const fp2 = computeCorpusFingerprint([rowA], "text-embedding-3-large");
    expect(fp1.corpusHash).toBe(fp2.corpusHash);
    expect(fp1.embeddingModel).not.toBe(fp2.embeddingModel);
  });

  it("handles an empty row list without throwing", () => {
    const { corpusHash } = computeCorpusFingerprint([], "text-embedding-3-small");
    expect(corpusHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
