import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { judgeRelevance } from "../src/judge.js";

const RELEVANT_RESPONSE = JSON.stringify({
  relevant: true,
  score: 0.9,
  reason: "directly answers the query",
});
const IRRELEVANT_RESPONSE = JSON.stringify({
  relevant: false,
  score: 0.1,
  reason: "unrelated topic",
});

const BASE_OPTIONS = {
  query: "What is pgvector?",
  model: "gpt-4o-mini",
  rubric: "Relevant if it directly explains pgvector or its usage.",
  rubricVersion: "v1",
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "driftwatch-judge-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("judgeRelevance", () => {
  it("returns a result for each chunk", async () => {
    const callModel = vi.fn().mockResolvedValue(RELEVANT_RESPONSE);
    const chunks = [
      { id: "doc-1", content: "pgvector is a PostgreSQL extension for vector similarity search." },
      { id: "doc-2", content: "pgvector supports HNSW and IVFFlat index types." },
    ];

    const results = await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(results).toHaveLength(2);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(results[0]?.id).toBe("doc-1");
    expect(results[1]?.id).toBe("doc-2");
    expect(results[0]?.relevant).toBe(true);
    expect(results[0]?.score).toBe(0.9);
    expect(results[0]?.reason).toBe("directly answers the query");
  });

  it("cache hit avoids calling callModel on second run", async () => {
    const callModel = vi.fn().mockResolvedValue(RELEVANT_RESPONSE);
    const chunks = [{ id: "doc-1", content: "pgvector is a PostgreSQL extension." }];

    await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });
    await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("preserves input order in returned results", async () => {
    const responses = [RELEVANT_RESPONSE, IRRELEVANT_RESPONSE, RELEVANT_RESPONSE];
    let callCount = 0;
    const callModel = vi.fn().mockImplementation(() => {
      const response = responses[callCount++] ?? IRRELEVANT_RESPONSE;
      return Promise.resolve(response);
    });

    const chunks = [
      { id: "a", content: "chunk a content" },
      { id: "b", content: "chunk b content" },
      { id: "c", content: "chunk c content" },
    ];

    const results = await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(results[0]?.relevant).toBe(true);
    expect(results[1]?.relevant).toBe(false);
    expect(results[2]?.relevant).toBe(true);
  });

  it("strips markdown code fences from the model response", async () => {
    const fenced = "```json\n" + RELEVANT_RESPONSE + "\n```";
    const callModel = vi.fn().mockResolvedValue(fenced);
    const chunks = [{ id: "doc-1", content: "some content" }];

    const results = await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(results[0]?.relevant).toBe(true);
    expect(results[0]?.score).toBe(0.9);
  });

  it("strips fences when the model prepends prose before the code block", async () => {
    const withPreamble = "Here is my evaluation:\n```json\n" + RELEVANT_RESPONSE + "\n```";
    const callModel = vi.fn().mockResolvedValue(withPreamble);
    const chunks = [{ id: "doc-1", content: "some content" }];

    const results = await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(results[0]?.relevant).toBe(true);
    expect(results[0]?.score).toBe(0.9);
  });

  it("strips fences when the model appends text after the closing fence", async () => {
    const withTrailing =
      "```json\n" + RELEVANT_RESPONSE + "\n```\nLet me know if you need anything.";
    const callModel = vi.fn().mockResolvedValue(withTrailing);
    const chunks = [{ id: "doc-1", content: "some content" }];

    const results = await judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir });

    expect(results[0]?.relevant).toBe(true);
    expect(results[0]?.score).toBe(0.9);
  });

  it("throws on invalid JSON response", async () => {
    const callModel = vi.fn().mockResolvedValue("not valid json at all");
    const chunks = [{ id: "doc-1", content: "some content" }];

    await expect(
      judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir }),
    ).rejects.toThrow("invalid JSON response");
  });

  it("throws when relevant is not boolean", async () => {
    const bad = JSON.stringify({ relevant: "yes", score: 0.9, reason: "ok" });
    const callModel = vi.fn().mockResolvedValue(bad);
    const chunks = [{ id: "doc-1", content: "some content" }];

    await expect(
      judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir }),
    ).rejects.toThrow('"relevant"');
  });

  it("throws when score is out of [0, 1] range", async () => {
    const bad = JSON.stringify({ relevant: true, score: 1.5, reason: "ok" });
    const callModel = vi.fn().mockResolvedValue(bad);
    const chunks = [{ id: "doc-1", content: "some content" }];

    await expect(
      judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir }),
    ).rejects.toThrow('"score"');
  });

  it("throws when required fields are missing from the response JSON", async () => {
    const bad = JSON.stringify({ text: "yes" });
    const callModel = vi.fn().mockResolvedValue(bad);
    const chunks = [{ id: "doc-1", content: "some content" }];

    await expect(
      judgeRelevance({ ...BASE_OPTIONS, chunks, callModel, cacheDir: tmpDir }),
    ).rejects.toThrow("missing required fields");
  });

  it("returns empty array without calling callModel when chunks is empty", async () => {
    const callModel = vi.fn();
    const results = await judgeRelevance({
      ...BASE_OPTIONS,
      chunks: [],
      callModel,
      cacheDir: tmpDir,
    });

    expect(results).toEqual([]);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("different rubricVersions produce separate cache entries", async () => {
    const callModel = vi.fn().mockResolvedValue(RELEVANT_RESPONSE);
    const chunks = [{ id: "doc-1", content: "pgvector is an extension." }];

    await judgeRelevance({
      ...BASE_OPTIONS,
      chunks,
      callModel,
      cacheDir: tmpDir,
      rubricVersion: "v1",
    });
    await judgeRelevance({
      ...BASE_OPTIONS,
      chunks,
      callModel,
      cacheDir: tmpDir,
      rubricVersion: "v2",
    });

    expect(callModel).toHaveBeenCalledTimes(2);
  });
});
