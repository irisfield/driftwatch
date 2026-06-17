import { readFile } from "node:fs/promises";

import { z } from "zod";

export interface GoldenEntry {
  query: string;
  relevant: string[];
  source?: "user" | "synthetic" | undefined;
}
export type GoldenDataset = GoldenEntry[];

export const goldenEntrySchema: z.ZodType<GoldenEntry> = z.object({
  query: z.string().min(1, "query must not be empty"),
  relevant: z
    .array(z.uuid({ error: "relevant IDs must be valid document UUIDs" }))
    .min(1, "relevant must contain at least one document ID"),
  source: z.enum(["user", "synthetic"]).optional(),
});

export const goldenDatasetSchema: z.ZodType<GoldenDataset> = z
  .array(goldenEntrySchema)
  .min(1, "golden dataset must contain at least one entry");

export function validateGoldenDataset(data: unknown): GoldenDataset {
  const result = goldenDatasetSchema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `[${issue.path.join(".")}] ` : "";
        return `${path}${issue.message}`;
      })
      .join("\n");
    throw new Error(`Invalid golden dataset:\n${messages}`);
  }
  return result.data;
}

export async function loadGoldenDataset(filePath: string): Promise<GoldenDataset> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Could not read golden dataset at "${filePath}": ${error.message}`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Golden dataset at "${filePath}" contains invalid JSON: ${error.message}`);
    }
    throw error;
  }

  return validateGoldenDataset(parsed);
}
