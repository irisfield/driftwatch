import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadGoldenDataset, validateGoldenDataset } from "../src/golden-schema.js";

// --- validateGoldenDataset ---

describe("validateGoldenDataset", () => {
  it("accepts a valid dataset and returns typed entries", () => {
    const data = [
      { query: "How do I enable RLS?", relevant: ["chunk-1", "chunk-2"] },
      { query: "What is pgvector?", relevant: ["chunk-3"] },
    ];
    const result = validateGoldenDataset(data);
    expect(result).toHaveLength(2);
    expect(result[0]?.query).toBe("How do I enable RLS?");
    expect(result[0]?.relevant).toEqual(["chunk-1", "chunk-2"]);
  });

  it("throws for an empty dataset array", () => {
    expect(() => validateGoldenDataset([])).toThrow("golden dataset must contain at least one");
  });

  it("throws for a missing query field", () => {
    expect(() => validateGoldenDataset([{ relevant: ["chunk-1"] }])).toThrow(
      "Invalid golden dataset",
    );
  });

  it("throws for an empty query string", () => {
    expect(() => validateGoldenDataset([{ query: "", relevant: ["chunk-1"] }])).toThrow(
      "query must not be empty",
    );
  });

  it("throws for a missing relevant field", () => {
    expect(() => validateGoldenDataset([{ query: "What is Supabase?" }])).toThrow(
      "Invalid golden dataset",
    );
  });

  it("throws for an empty relevant array", () => {
    expect(() => validateGoldenDataset([{ query: "What is Supabase?", relevant: [] }])).toThrow(
      "relevant must contain at least one",
    );
  });

  it("throws for an empty string inside relevant", () => {
    expect(() => validateGoldenDataset([{ query: "What is Supabase?", relevant: [""] }])).toThrow(
      "relevant IDs must not be empty strings",
    );
  });

  it("includes the field path in the error message", () => {
    try {
      validateGoldenDataset([{ query: "", relevant: ["chunk-1"] }]);
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("[0.query]");
    }
  });

  it("throws for non-array input", () => {
    expect(() => validateGoldenDataset({ query: "q", relevant: ["c"] })).toThrow(
      "Invalid golden dataset",
    );
  });

  it("throws for null", () => {
    expect(() => validateGoldenDataset(null)).toThrow("Invalid golden dataset");
  });
});

// --- loadGoldenDataset ---

describe("loadGoldenDataset", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(tmpdir(), `driftwatch-test-${String(Date.now())}.json`);
  });

  afterEach(async () => {
    await rm(tmpPath, { force: true });
  });

  it("reads a valid JSON file and returns typed entries", async () => {
    const entries = [{ query: "What is pgvector?", relevant: ["chunk-1"] }];
    await writeFile(tmpPath, JSON.stringify(entries), "utf8");
    const result = await loadGoldenDataset(tmpPath);
    expect(result).toHaveLength(1);
    expect(result[0]?.query).toBe("What is pgvector?");
  });

  it("throws with the file path when the file does not exist", async () => {
    await expect(loadGoldenDataset("/no/such/file.json")).rejects.toThrow(
      'Could not read golden dataset at "/no/such/file.json"',
    );
  });

  it("throws an invalid JSON message for unparseable content", async () => {
    await writeFile(tmpPath, "{ not valid json }", "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow("invalid JSON");
  });

  it("throws a schema error when the file is valid JSON but fails validation", async () => {
    await writeFile(tmpPath, JSON.stringify([{ query: "", relevant: ["c"] }]), "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow("query must not be empty");
  });

  it("throws for an empty array in the file", async () => {
    await writeFile(tmpPath, "[]", "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow(
      "golden dataset must contain at least one",
    );
  });
});
