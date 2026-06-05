import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadGoldenDataset, validateGoldenDataset } from "../src/golden-schema.js";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "550e8400-e29b-41d4-a716-446655440001";
const UUID_C = "550e8400-e29b-41d4-a716-446655440002";

// --- validateGoldenDataset ---

describe("validateGoldenDataset", () => {
  it("accepts a valid dataset and returns typed entries", () => {
    const data = [
      { query: "How do I enable RLS?", relevant: [UUID_A, UUID_B] },
      { query: "What is pgvector?", relevant: [UUID_C] },
    ];
    const result = validateGoldenDataset(data);
    expect(result).toHaveLength(2);
    expect(result[0]?.query).toBe("How do I enable RLS?");
    expect(result[0]?.relevant).toEqual([UUID_A, UUID_B]);
  });

  it("accepts entries with source field", () => {
    const data = [
      { query: "How do I enable RLS?", relevant: [UUID_A], source: "user" },
      { query: "What is pgvector?", relevant: [UUID_B], source: "synthetic" },
    ];
    const result = validateGoldenDataset(data);
    expect(result[0]?.source).toBe("user");
    expect(result[1]?.source).toBe("synthetic");
  });

  it("accepts entries without the optional source field", () => {
    const data = [{ query: "What is pgvector?", relevant: [UUID_A] }];
    const result = validateGoldenDataset(data);
    expect(result[0]?.source).toBeUndefined();
  });

  it("throws for an invalid source value", () => {
    expect(() =>
      validateGoldenDataset([{ query: "q", relevant: [UUID_A], source: "manual" }]),
    ).toThrow("Invalid golden dataset");
  });

  it("throws for an empty dataset array", () => {
    expect(() => validateGoldenDataset([])).toThrow("golden dataset must contain at least one");
  });

  it("throws for a missing query field", () => {
    expect(() => validateGoldenDataset([{ relevant: [UUID_A] }])).toThrow("Invalid golden dataset");
  });

  it("throws for an empty query string", () => {
    expect(() => validateGoldenDataset([{ query: "", relevant: [UUID_A] }])).toThrow(
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

  it("throws for a non-UUID string inside relevant", () => {
    expect(() =>
      validateGoldenDataset([{ query: "What is Supabase?", relevant: ["chunk-1"] }]),
    ).toThrow("relevant IDs must be valid document UUIDs");
  });

  it("throws for an empty string inside relevant", () => {
    expect(() => validateGoldenDataset([{ query: "What is Supabase?", relevant: [""] }])).toThrow(
      "relevant IDs must be valid document UUIDs",
    );
  });

  it("includes the field path in the error message", () => {
    try {
      validateGoldenDataset([{ query: "", relevant: [UUID_A] }]);
      expect.fail("should have thrown");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("[0.query]");
    }
  });

  it("throws for non-array input", () => {
    expect(() => validateGoldenDataset({ query: "q", relevant: [UUID_A] })).toThrow(
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
    const entries = [{ query: "What is pgvector?", relevant: [UUID_A] }];
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
    await writeFile(tmpPath, JSON.stringify([{ query: "", relevant: [UUID_A] }]), "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow("query must not be empty");
  });

  it("throws for an empty array in the file", async () => {
    await writeFile(tmpPath, "[]", "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow(
      "golden dataset must contain at least one",
    );
  });

  it("throws for non-UUID relevant IDs in the file", async () => {
    const entries = [{ query: "What is pgvector?", relevant: ["not-a-uuid"] }];
    await writeFile(tmpPath, JSON.stringify(entries), "utf8");
    await expect(loadGoldenDataset(tmpPath)).rejects.toThrow(
      "relevant IDs must be valid document UUIDs",
    );
  });
});
