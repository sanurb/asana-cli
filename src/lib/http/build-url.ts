import type { QueryParams } from "../types/query-params.ts"

const LEADING_SLASHES_RE = /^\/+/

export interface BuildUrlInput {
  readonly baseUrl: string
  readonly path: string
  readonly params: QueryParams | undefined
}

function assertNonEmpty(name: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`buildUrl: ${name} must be a non-empty string`)
  }
  return trimmed
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://")
}

function normalizeRelativePath(path: string): string {
  // Base invariant: relative paths cannot be empty.
  const trimmed = assertNonEmpty("path", path)
  return trimmed.replace(LEADING_SLASHES_RE, "")
}

function normalizeBase(baseUrl: string): string {
  const base = assertNonEmpty("baseUrl", baseUrl)
  return base.endsWith("/") ? base : `${base}/`
}

function appendQueryParams(url: URL, params: QueryParams): void {
  for (const key in params) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      continue
    }

    const value = params[key]
    if (value === null || value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === null || v === undefined) {
          continue
        }
        url.searchParams.append(key, String(v))
      }
      continue
    }

    url.searchParams.append(key, String(value))
  }
}

export function buildUrl(input: BuildUrlInput): string {
  const rawPath = input.path.trim()

  const url = isAbsoluteUrl(rawPath)
    ? new URL(assertNonEmpty("path", rawPath))
    : new URL(normalizeRelativePath(rawPath), normalizeBase(input.baseUrl))

  const params = input.params
  if (params !== undefined) {
    appendQueryParams(url, params)
  }

  return url.toString()
}