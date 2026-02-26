/**
 * Injectable HTTP client for the Asana REST API.
 *
 * The `RequestFn` type is the minimal surface callers need: method, path, options.
 * Create one per AsanaClient via `createRequestFn(token, baseUrl)`.
 * Tests stub this with `Bun.serve` returning canned responses.
 */

import { SdkError } from "./errors.ts";

export const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

export type QueryParams = Record<string, string | number | boolean | undefined>;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type RequestOptions = {
  readonly query?: QueryParams;
  readonly body?: unknown;
  /** Optional per-call signal (e.g. AbortSignal.timeout). Merged with client-level signal. */
  readonly signal?: AbortSignal;
};

export type ApiEnvelope<T> = {
  readonly data: T;
};

export type PaginatedEnvelope<T> = {
  readonly data: readonly T[];
  readonly next_page?: { readonly offset?: string } | null;
};

export type RequestFn = <T = unknown>(
  method: HttpMethod,
  path: string,
  opts?: RequestOptions,
) => Promise<ApiEnvelope<T>>;

// ── URL builder ──────────────────────────────────────────────────────

function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// ── Response handling ────────────────────────────────────────────────

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    const text = (await safeText(res)).slice(0, 200);
    throw new SdkError(
      `API returned non-JSON (content-type: ${contentType}): ${text}`,
      "API_ERROR",
    );
  }
  let json: unknown;
  try { json = await res.json(); } catch (cause) {
    throw new SdkError("Failed to parse API JSON response", "API_ERROR");
  }
  if (json === null || typeof json !== "object") {
    throw new SdkError("API envelope is not an object", "API_ERROR");
  }
  if (!("data" in (json as object))) {
    throw new SdkError("API envelope missing 'data' field", "API_ERROR");
  }
  return json as ApiEnvelope<T>;
}

async function throwIfError(res: Response, method: string, path: string): Promise<void> {
  if (res.ok) return;
  const text = await safeText(res);
  let asanaMessage = `${method} ${path} → HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text) as { errors?: { message?: string }[] };
    const first = parsed.errors?.[0]?.message;
    if (first) asanaMessage = first;
  } catch { /* use status-based message */ }
  const code = res.status === 401 ? "AUTH_MISSING"
    : res.status === 404 ? "NOT_FOUND"
    : res.status === 429 ? "RATE_LIMITED"
    : "API_ERROR";
  throw new SdkError(asanaMessage, code, `HTTP ${res.status}: ${res.statusText}`);
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Returns a `RequestFn` bound to `token` and `baseUrl`.
 * Inject this into an `AsanaClient` — never store token elsewhere.
 */
export function createRequestFn(
  token: string,
  baseUrl = ASANA_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): RequestFn {
  return async function request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions,
  ): Promise<ApiEnvelope<T>> {
    const url = buildUrl(baseUrl, path, opts?.query);
    const hasBody = opts?.body !== undefined;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (hasBody) headers["Content-Type"] = "application/json";

    const init: RequestInit = {
      method,
      headers,
      signal: opts?.signal,
      ...(hasBody ? { body: JSON.stringify({ data: opts!.body }) } : {}),
    };

    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (cause) {
      throw new SdkError(
        `Network error: ${method} ${path}`,
        "NETWORK_ERROR",
        "Check network connectivity and retry.",
      );
    }

    await throwIfError(res, method, path);

    // DELETE / 204 No Content
    if (method === "DELETE" || res.status === 204) {
      return { data: {} as unknown as T };
    }

    return parseEnvelope<T>(res);
  };
}

// ── Paginator ────────────────────────────────────────────────────────

/**
 * Collects all pages using Asana's offset-based pagination.
 * Stops when there are no more pages or `maxItems` is reached.
 */
export async function paginate<T>(
  request: RequestFn,
  path: string,
  query: QueryParams = {},
  maxItems?: number,
): Promise<T[]> {
  const all: T[] = [];
  let offset: string | undefined;

  do {
    const pageQuery: QueryParams = offset === undefined ? query : { ...query, offset };
    const res = await request<readonly T[]>("GET", path, { query: pageQuery }) as PaginatedEnvelope<T>;
    const chunk = Array.isArray(res.data) ? (res.data as T[]) : [];

    if (maxItems !== undefined) {
      const remaining = maxItems - all.length;
      if (remaining <= 0) break;
      all.push(...chunk.slice(0, remaining));
      offset = chunk.length >= remaining ? undefined : res.next_page?.offset;
      continue;
    }

    all.push(...chunk);
    offset = res.next_page?.offset;
  } while (offset !== undefined);

  return all;
}
