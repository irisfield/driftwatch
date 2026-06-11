// The Gemini free tier rate-limits both chat (generate_content_free_tier_requests,
// 5 req/min for gemini-2.5-flash) and embeddings (embed_content_free_tier_requests,
// 100 req/min) per project per model. Retry on 429 with the delay Gemini reports
// in the error body's details[].retryDelay (e.g. "17s"), not via an HTTP
// Retry-After header, which Gemini does not set.
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2000;
const RETRY_SAFETY_MARGIN_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(body: string): number | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || !("error" in json)) return undefined;
  const error: unknown = json.error;
  if (typeof error !== "object" || error === null || !("details" in error)) return undefined;
  const details: unknown = error.details;
  if (!Array.isArray(details)) return undefined;

  const detail = details.find(
    (d: unknown): d is { retryDelay: string } =>
      typeof d === "object" && d !== null && "retryDelay" in d && typeof d.retryDelay === "string",
  );
  if (detail === undefined) return undefined;

  const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
  if (match === null) return undefined;
  const secondsStr = match[1];
  if (secondsStr === undefined) return undefined;
  const seconds = Number(secondsStr);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= MAX_RETRIES) {
      return response;
    }
    const body = await response.text();
    const reportedDelayMs = parseRetryDelayMs(body);
    const delayMs =
      reportedDelayMs === undefined
        ? RETRY_BASE_MS * 2 ** attempt
        : reportedDelayMs + RETRY_SAFETY_MARGIN_MS;
    await sleep(delayMs);
  }
}
