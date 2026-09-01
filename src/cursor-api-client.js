const DEFAULT_BASE_URL = "https://api.cursor.com";
const MAX_429_RETRIES = 5;
const MAX_429_BACKOFF_MS = 16_000;

export class CursorApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {{ retryable429?: boolean }} [options]
   */
  constructor(message, status, options = {}) {
    super(message);
    this.name = "CursorApiError";
    this.status = status;
    this.retryable429 = Boolean(options.retryable429);
  }
}

/** @param {string} apiKey */
export function adminApiAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {{ apiKey: string, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function postAdminJson(
  path,
  body,
  { apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 60_000 }
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(path, baseUrl).toString();
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: adminApiAuthHeader(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (response.status === 429) {
      throw new CursorApiError("Cursor Admin API rate limited (429)", 429, { retryable429: true });
    }
    if (!response.ok) {
      throw new CursorApiError(`Cursor Admin API ${response.status} ${response.statusText}`, response.status);
    }

    return response.json();
  } catch (error) {
    if (error instanceof CursorApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new CursorApiError("Cursor Admin API request timed out", 408);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} path
 * @param {(page: number) => Record<string, unknown>} buildBody
 * @param {(payload: unknown) => { items: unknown[], hasNextPage: boolean }} parsePage
 * @param {{ apiKey: string, baseUrl?: string, fetchImpl?: typeof fetch, onPage?: (page: number) => void }} options
 */
export async function paginateAdmin(path, buildBody, parsePage, options) {
  /** @type {unknown[]} */
  const merged = [];
  let page = 1;
  let hasNextPage = true;
  let retry429 = 0;

  while (hasNextPage) {
    options.onPage?.(page);

    let payload;
    try {
      payload = await postAdminJson(path, buildBody(page), options);
      retry429 = 0;
    } catch (error) {
      if (error instanceof CursorApiError && error.retryable429 && retry429 < MAX_429_RETRIES) {
        await sleep(Math.min(1000 * 2 ** retry429, MAX_429_BACKOFF_MS));
        retry429 += 1;
        continue;
      }
      throw error;
    }

    const { items, hasNextPage: next } = parsePage(payload);
    merged.push(...items);
    hasNextPage = next;
    if (hasNextPage) {
      page += 1;
    }
  }

  return merged;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
