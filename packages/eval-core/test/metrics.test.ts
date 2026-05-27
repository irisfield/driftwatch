import { describe, expect, it } from "vitest";

import { hitRate, mrr, ndcgAtK, precisionAtK, recallAtK } from "../src/metrics.js";

// Fixtures verified by hand. See comments for each computation.

describe("recallAtK", () => {
  it("counts relevant hits in top K divided by total relevant", () => {
    // retrieved: [a, b, c, d, e]  relevant: [b, d]  k=3
    // top 3: [a, b, c]  hits: {b} = 1  recall = 1/2
    expect(recallAtK(["a", "b", "c", "d", "e"], ["b", "d"], 3)).toBeCloseTo(0.5);
  });

  it("returns 1 when all relevant docs appear in top K", () => {
    // top 3: [a, b, c]  relevant: [a, c]  hits = 2  recall = 2/2
    expect(recallAtK(["a", "b", "c"], ["a", "c"], 3)).toBe(1);
  });

  it("returns 0 when no relevant doc appears in top K", () => {
    // top 3: [a, b, c]  relevant: [z]  hits = 0
    expect(recallAtK(["a", "b", "c"], ["z"], 3)).toBe(0);
  });

  it("returns 0 when relevant list is empty", () => {
    expect(recallAtK(["a", "b", "c"], [], 3)).toBe(0);
  });

  it("ignores results beyond k", () => {
    // retrieved: [a, b, c, d]  relevant: [d]  k=3
    // top 3: [a, b, c]  hits = 0
    expect(recallAtK(["a", "b", "c", "d"], ["d"], 3)).toBe(0);
  });

  it("handles k larger than retrieved length", () => {
    // retrieved: [a, b]  relevant: [b]  k=5 → top 2: [a,b]  hits=1  recall=1
    expect(recallAtK(["a", "b"], ["b"], 5)).toBe(1);
  });

  it("returns 0 when retrieved is empty", () => {
    expect(recallAtK([], ["a"], 5)).toBe(0);
  });
});

describe("precisionAtK", () => {
  it("counts relevant hits in top K divided by K", () => {
    // top 3: [a, b, c]  relevant: [b, d]  hits=1  precision=1/3
    expect(precisionAtK(["a", "b", "c", "d", "e"], ["b", "d"], 3)).toBeCloseTo(1 / 3);
  });

  it("returns 1 when every top-K result is relevant", () => {
    // top 2: [a, b]  relevant: [a, b]  precision = 2/2
    expect(precisionAtK(["a", "b", "c"], ["a", "b"], 2)).toBe(1);
  });

  it("returns 0 when no relevant doc appears in top K", () => {
    expect(precisionAtK(["a", "b", "c"], ["z"], 3)).toBe(0);
  });

  it("returns 0 for k=0", () => {
    expect(precisionAtK(["a", "b"], ["a"], 0)).toBe(0);
  });

  it("ignores results beyond k", () => {
    // top 1: [a]  relevant: [b]  hits=0
    expect(precisionAtK(["a", "b"], ["b"], 1)).toBe(0);
  });
});

describe("mrr", () => {
  it("returns reciprocal rank of the first relevant result", () => {
    // [a, b, c, d, e]  relevant: [b, d]  first hit: b at rank 2 → 1/2
    expect(mrr(["a", "b", "c", "d", "e"], ["b", "d"])).toBeCloseTo(0.5);
  });

  it("returns 1 when the first result is relevant", () => {
    expect(mrr(["b", "a", "c"], ["b"])).toBe(1);
  });

  it("returns 1/3 when the third result is the first relevant", () => {
    // [a, b, c]  relevant: [c]  first hit at rank 3 → 1/3
    expect(mrr(["a", "b", "c"], ["c"])).toBeCloseTo(1 / 3);
  });

  it("returns 0 when no relevant result is retrieved", () => {
    expect(mrr(["a", "b", "c"], ["z"])).toBe(0);
  });

  it("returns 0 for empty retrieved", () => {
    expect(mrr([], ["a"])).toBe(0);
  });

  it("returns 0 for empty relevant", () => {
    expect(mrr(["a", "b"], [])).toBe(0);
  });
});

describe("ndcgAtK", () => {
  // log2(2)=1, log2(3)≈1.585, log2(4)=2, log2(5)≈2.322

  it("computes DCG/IDCG for a partial hit", () => {
    // retrieved: [a, b, c, d, e]  relevant: [b, d]  k=3
    // DCG@3: a→0, b→1/log2(3)≈0.6309, c→0  → DCG≈0.6309
    // IDCG@3: min(2,3)=2 ideal hits: 1/log2(2)+1/log2(3)=1+0.6309=1.6309
    // nDCG = 0.6309/1.6309 ≈ 0.3868
    expect(ndcgAtK(["a", "b", "c", "d", "e"], ["b", "d"], 3)).toBeCloseTo(
      1 / Math.log2(3) / (1 / Math.log2(2) + 1 / Math.log2(3)),
    );
  });

  it("returns 1 when retrieved order is ideal", () => {
    // retrieved: [b, d, a]  relevant: [b, d]  k=2
    // DCG@2: b→1/log2(2)=1, d→1/log2(3)≈0.6309  → DCG≈1.6309
    // IDCG@2 = same → nDCG = 1
    expect(ndcgAtK(["b", "d", "a"], ["b", "d"], 2)).toBeCloseTo(1);
  });

  it("returns 0 when no relevant doc is in top K", () => {
    expect(ndcgAtK(["a", "b", "c"], ["z"], 3)).toBe(0);
  });

  it("returns 0 for empty relevant", () => {
    expect(ndcgAtK(["a", "b"], [], 3)).toBe(0);
  });

  it("returns 0 for k=0", () => {
    expect(ndcgAtK(["a", "b"], ["a"], 0)).toBe(0);
  });

  it("penalizes lower-ranked hits vs higher-ranked hits", () => {
    // [a, b]  relevant: [b]  k=2: hit at pos 1 → 1/log2(3)
    // IDCG@2 for 1 relevant: 1/log2(2)=1
    // nDCG = (1/log2(3))/1 = 1/log2(3) ≈ 0.6309
    const lowerRanked = ndcgAtK(["a", "b"], ["b"], 2);

    // [b, a]  relevant: [b]  k=2: hit at pos 0 → 1/log2(2)=1
    // nDCG = 1/1 = 1
    const higherRanked = ndcgAtK(["b", "a"], ["b"], 2);

    expect(higherRanked).toBeGreaterThan(lowerRanked);
    expect(higherRanked).toBeCloseTo(1);
    expect(lowerRanked).toBeCloseTo(1 / Math.log2(3));
  });

  it("multiple relevant docs all in top K", () => {
    // [a, b, c]  relevant: [a, c]  k=3
    // DCG@3: a→1/log2(2)=1, b→0, c→1/log2(4)=0.5  → DCG=1.5
    // IDCG@3: 2 ideal hits: 1/log2(2)+1/log2(3)=1+0.6309=1.6309
    // nDCG = 1.5/1.6309 ≈ 0.9197
    expect(ndcgAtK(["a", "b", "c"], ["a", "c"], 3)).toBeCloseTo(
      1.5 / (1 / Math.log2(2) + 1 / Math.log2(3)),
    );
  });
});

describe("hitRate", () => {
  it("returns 1 when a relevant doc appears in top K", () => {
    expect(hitRate(["a", "b", "c"], ["b"], 3)).toBe(1);
  });

  it("returns 0 when no relevant doc appears in top K", () => {
    expect(hitRate(["a", "b", "c"], ["z"], 3)).toBe(0);
  });

  it("returns 0 when relevant doc is beyond k", () => {
    // retrieved: [a, b, c, d]  relevant: [d]  k=3 → top 3: [a,b,c] → miss
    expect(hitRate(["a", "b", "c", "d"], ["d"], 3)).toBe(0);
  });

  it("returns 1 when the first result is relevant", () => {
    expect(hitRate(["b", "a", "c"], ["b"], 1)).toBe(1);
  });

  it("returns 0 for empty retrieved", () => {
    expect(hitRate([], ["a"], 5)).toBe(0);
  });

  it("returns 0 for empty relevant", () => {
    expect(hitRate(["a", "b"], [], 3)).toBe(0);
  });
});
