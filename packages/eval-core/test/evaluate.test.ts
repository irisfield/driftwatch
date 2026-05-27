import { describe, expect, it, vi } from "vitest";

import { evaluateRetrieval } from "../src/evaluate.js";
import { ndcgAtK, recallAtK } from "../src/metrics.js";

// Fixture golden dataset used across tests
const golden = [
  { query: "query-A", relevant: ["b", "d"] },
  { query: "query-B", relevant: ["x"] },
];

describe("evaluateRetrieval", () => {
  it("calls retrieve exactly once per golden entry", async () => {
    const retrieve = vi.fn().mockResolvedValue(["a", "b", "c"]);
    await evaluateRetrieval({ golden, retrieve, k: 3 });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenCalledWith("query-A");
    expect(retrieve).toHaveBeenCalledWith("query-B");
  });

  it("computes per-query metrics against hand-computed values", async () => {
    // query-A: retrieved=[a,b,c,d,e]  relevant=[b,d]  k=3
    //   recallAtK = 1/2=0.5  (b found, d not in top-3)
    //   precisionAtK = 1/3
    //   mrr = 1/2 (b at rank 2)
    //   ndcgAtK = (1/log2(3)) / (1/log2(2)+1/log2(3))
    //   hitRate = 1
    //
    // query-B: retrieved=[z,x]  relevant=[x]  k=3
    //   recallAtK = 1  (x found)
    //   precisionAtK = 1/3 (1 hit / k=3 even though only 2 retrieved)
    //   mrr = 1/2 (x at rank 2)
    //   ndcgAtK = (1/log2(3)) / (1/log2(2))  = 1/log2(3)
    //   hitRate = 1

    const retrieve = vi.fn().mockImplementation((query: string) => {
      if (query === "query-A") return Promise.resolve(["a", "b", "c", "d", "e"]);
      return Promise.resolve(["z", "x"]);
    });

    const report = await evaluateRetrieval({ golden, retrieve, k: 3 });

    const qA = report.queries[0];
    const qB = report.queries[1];

    expect(qA?.query).toBe("query-A");
    expect(qA?.retrieved).toEqual(["a", "b", "c", "d", "e"]);
    expect(qA?.relevant).toEqual(["b", "d"]);
    expect(qA?.recallAtK).toBeCloseTo(0.5);
    expect(qA?.precisionAtK).toBeCloseTo(1 / 3);
    expect(qA?.mrr).toBeCloseTo(0.5);
    expect(qA?.ndcgAtK).toBeCloseTo(1 / Math.log2(3) / (1 / Math.log2(2) + 1 / Math.log2(3)));
    expect(qA?.hitRate).toBe(1);

    expect(qB?.recallAtK).toBeCloseTo(1);
    expect(qB?.precisionAtK).toBeCloseTo(1 / 3);
    expect(qB?.mrr).toBeCloseTo(0.5);
    expect(qB?.ndcgAtK).toBeCloseTo(1 / Math.log2(3));
    expect(qB?.hitRate).toBe(1);
  });

  it("computes aggregate means correctly", async () => {
    // Using same fixture as above.
    // recallAtK mean = (0.5 + 1) / 2 = 0.75
    // mrr mean = (0.5 + 0.5) / 2 = 0.5
    // hitRate mean = (1 + 1) / 2 = 1

    const retrieve = vi.fn().mockImplementation((query: string) => {
      if (query === "query-A") return Promise.resolve(["a", "b", "c", "d", "e"]);
      return Promise.resolve(["z", "x"]);
    });

    const report = await evaluateRetrieval({ golden, retrieve, k: 3 });

    // Verify against the metric functions directly as ground truth
    const recallA = recallAtK(["a", "b", "c", "d", "e"], ["b", "d"], 3);
    const recallB = recallAtK(["z", "x"], ["x"], 3);
    expect(report.recallAtK).toBeCloseTo((recallA + recallB) / 2);

    const ndcgA = ndcgAtK(["a", "b", "c", "d", "e"], ["b", "d"], 3);
    const ndcgB = ndcgAtK(["z", "x"], ["x"], 3);
    expect(report.ndcgAtK).toBeCloseTo((ndcgA + ndcgB) / 2);

    expect(report.mrr).toBeCloseTo(0.5);
    expect(report.hitRate).toBeCloseTo(1);
    expect(report.k).toBe(3);
  });

  it("records evaluatedAt as an ISO 8601 string", async () => {
    const retrieve = vi.fn().mockResolvedValue(["a"]);
    const before = new Date();
    const report = await evaluateRetrieval({
      golden: [{ query: "q", relevant: ["a"] }],
      retrieve,
      k: 1,
    });
    const after = new Date();
    const ts = new Date(report.evaluatedAt);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("handles a single-entry golden dataset", async () => {
    const retrieve = vi.fn().mockResolvedValue(["doc-1", "doc-2"]);
    const report = await evaluateRetrieval({
      golden: [{ query: "single query", relevant: ["doc-1"] }],
      retrieve,
      k: 5,
    });
    expect(report.queries).toHaveLength(1);
    expect(report.recallAtK).toBe(1);
    expect(report.hitRate).toBe(1);
    expect(report.mrr).toBe(1);
  });

  it("returns zero aggregate metrics when nothing is retrieved", async () => {
    const retrieve = vi.fn().mockResolvedValue([]);
    const report = await evaluateRetrieval({
      golden: [
        { query: "q1", relevant: ["a"] },
        { query: "q2", relevant: ["b"] },
      ],
      retrieve,
      k: 5,
    });
    expect(report.recallAtK).toBe(0);
    expect(report.precisionAtK).toBe(0);
    expect(report.mrr).toBe(0);
    expect(report.ndcgAtK).toBe(0);
    expect(report.hitRate).toBe(0);
  });
});
