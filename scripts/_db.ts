import pg from "pg";

export async function assertGoldenNotStale(
  pool: pg.Pool,
  goldenIds: string[],
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM documents WHERE id = ANY($1::uuid[])",
    [goldenIds],
  );
  const foundIds = new Set(result.rows.map((r) => r.id));
  const missing = goldenIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Golden set contains ${String(missing.length)} document IDs not in the corpus.\n` +
        `Run scripts/bootstrap-golden.ts to regenerate, or remove stale entries.\n` +
        `Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
    );
  }
}
