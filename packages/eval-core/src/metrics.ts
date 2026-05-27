export function recallAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (relevant.length === 0) return 0;
  const relevantSet = new Set(relevant);
  let hits = 0;
  let checked = 0;
  for (const id of retrieved) {
    if (checked === k) break;
    if (relevantSet.has(id)) hits++;
    checked++;
  }
  return hits / relevant.length;
}

export function precisionAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (k === 0) return 0;
  const relevantSet = new Set(relevant);
  let hits = 0;
  let checked = 0;
  for (const id of retrieved) {
    if (checked === k) break;
    if (relevantSet.has(id)) hits++;
    checked++;
  }
  return hits / k;
}

export function mrr(retrieved: readonly string[], relevant: readonly string[]): number {
  const relevantSet = new Set(relevant);
  let rank = 1;
  for (const id of retrieved) {
    if (relevantSet.has(id)) return 1 / rank;
    rank++;
  }
  return 0;
}

export function ndcgAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (relevant.length === 0 || k === 0) return 0;
  const relevantSet = new Set(relevant);

  let dcg = 0;
  let i = 0;
  for (const id of retrieved) {
    if (i === k) break;
    if (relevantSet.has(id)) dcg += 1 / Math.log2(i + 2);
    i++;
  }

  const idealHits = Math.min(relevant.length, k);
  let idcg = 0;
  for (let j = 0; j < idealHits; j++) {
    idcg += 1 / Math.log2(j + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

export function hitRate(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  const relevantSet = new Set(relevant);
  let checked = 0;
  for (const id of retrieved) {
    if (checked === k) break;
    if (relevantSet.has(id)) return 1;
    checked++;
  }
  return 0;
}
