import { buildApiError } from "./api-error";
import { EmptyObject } from "../types/empty-object";
import { QueryParams } from "../types/query-params";
import { Simplify } from "../types/simplify";
import { UnknownRecord } from "../types/unknown-record";
import { buildUrl } from "./build-url";
import { getToken } from "../auth/token";

const BASE_URL = "https://app.asana.com/api/1.0";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type HttpMethodWithBody = "POST" | "PUT";
type HttpMethodWithoutBody = Exclude<HttpMethod, HttpMethodWithBody>;

type ApiEnvelope<TData> = {
  readonly data: TData;
};

type QueryOnlyOptions = Simplify<{
  readonly query?: QueryParams;
  readonly body?: never;
}>;

type QueryBodyOptions = Simplify<{
  readonly query?: QueryParams;
  readonly body?: unknown;
}>;

type ApiOptionsFor<TMethod extends HttpMethod> = TMethod extends HttpMethodWithBody
  ? QueryBodyOptions
  : QueryOnlyOptions;

const EMPTY_OBJECT: EmptyObject = {} as EmptyObject;

const HTTP_STATUS = {
  NO_CONTENT: 204,
} as const;

const HTTP_HEADER = {
  AUTHORIZATION: "Authorization",
  ACCEPT: "Accept",
  CONTENT_TYPE: "Content-Type",
} as const;

const MEDIA_TYPE = {
  JSON: "application/json",
} as const;

const ERROR_MESSAGE = {
  MISSING_TOKEN: "Missing auth token",
  NETWORK_FAILURE: "Network error calling API",
  RESPONSE_NOT_JSON: "Invalid API response: expected JSON",
  RESPONSE_INVALID_JSON: "Invalid API response: failed to parse JSON",
  ENVELOPE_NOT_OBJECT: "Invalid API response: expected JSON object envelope",
  ENVELOPE_MISSING_DATA: "Invalid API response: missing 'data' property",
} as const;

const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

const getAuthTokenOrThrow = (): string => {
  const token = getToken()!;
  if (!token) throw new Error(ERROR_MESSAGE.MISSING_TOKEN);
  return token;
};

const hasBody = (opts: { readonly body?: unknown } | undefined): boolean => opts?.body !== undefined;

const shouldReturnEmptyEnvelope = (method: HttpMethod, status: number): boolean =>
  method === "DELETE" || status === HTTP_STATUS.NO_CONTENT;

const createRequestHeaders = (includeJsonContentType: boolean): HeadersInit => {
  const token = getAuthTokenOrThrow();

  const headers: Record<string, string> = {
    [HTTP_HEADER.AUTHORIZATION]: `Bearer ${token}`,
    [HTTP_HEADER.ACCEPT]: MEDIA_TYPE.JSON,
  };

  if (includeJsonContentType) headers[HTTP_HEADER.CONTENT_TYPE] = MEDIA_TYPE.JSON;

  return headers;
};

const encodeJsonEnvelopeBody = (body: unknown): string => JSON.stringify({ data: body });

const createRequestInit = (method: HttpMethod, opts: { readonly body?: unknown } | undefined): RequestInit => {
  const includeBody = hasBody(opts);

  const init: RequestInit = {
    method,
    headers: createRequestHeaders(includeBody),
  };

  if (includeBody) init.body = encodeJsonEnvelopeBody(opts!.body);

  return init;
};

const safeReadText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

const getContentTypeLower = (res: Response): string => (res.headers.get(HTTP_HEADER.CONTENT_TYPE) ?? "").toLowerCase();

const isJsonResponse = (res: Response): boolean => getContentTypeLower(res).includes(MEDIA_TYPE.JSON);

const toActionableContentTypeError = async (res: Response): Promise<Error> => {
  const contentType = res.headers.get(HTTP_HEADER.CONTENT_TYPE) ?? "unknown";
  const text = await safeReadText(res);
  const bodyPreview = text.slice(0, 200);

  return new Error(
    `${ERROR_MESSAGE.RESPONSE_NOT_JSON}. content-type=${contentType}; bodyPreview=${bodyPreview}`,
  );
};

const parseJson = async (res: Response): Promise<unknown> => {
  try {
    return (await res.json()) as unknown;
  } catch (cause) {
    throw new Error(ERROR_MESSAGE.RESPONSE_INVALID_JSON, { cause });
  }
};

const parseEnvelopeJson = async <TData>(res: Response): Promise<ApiEnvelope<TData>> => {
  if (!isJsonResponse(res)) throw await toActionableContentTypeError(res);

  const json = await parseJson(res);

  if (!isUnknownRecord(json)) throw new Error(ERROR_MESSAGE.ENVELOPE_NOT_OBJECT);
  if (!("data" in json)) throw new Error(ERROR_MESSAGE.ENVELOPE_MISSING_DATA);

  return json as ApiEnvelope<TData>;
};

const fetchOrThrowNetworkError = async (url: string, init: RequestInit, method: HttpMethod, path: string): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch (cause) {
    throw new Error(`${ERROR_MESSAGE.NETWORK_FAILURE}: ${method} ${path}`, { cause });
  }
};

const throwIfNotOk = async (res: Response, method: HttpMethod, path: string): Promise<void> => {
  if (res.ok) return;

  const text = await safeReadText(res);
  throw buildApiError({
    command: method,
    status: res.status,
    statusText: res.statusText,
    body: text,
    next_actions: [
    ],
  });
};

export function api<T = unknown>(
  method: HttpMethodWithoutBody,
  path: string,
  opts?: QueryOnlyOptions,
): Promise<ApiEnvelope<T>>;
export function api<T = unknown>(
  method: HttpMethodWithBody,
  path: string,
  opts?: QueryBodyOptions,
): Promise<ApiEnvelope<T>>;
export async function api<T = unknown>(
  method: HttpMethod,
  path: string,
  opts?: { query?: QueryParams; body?: unknown },
): Promise<ApiEnvelope<T>> {
  const url = buildUrl({
    baseUrl: BASE_URL,
    path,
    params: opts?.query,
  });
  const init = createRequestInit(method, opts);

  const res = await fetchOrThrowNetworkError(url, init, method, path);

  await throwIfNotOk(res, method, path);

  if (shouldReturnEmptyEnvelope(method, res.status)) {
    return { data: EMPTY_OBJECT as unknown as T };
  }

  return parseEnvelopeJson<T>(res);
}