import { api } from "../http/http-json-client";
import type { QueryParams } from "../types/query-params";

type AsanaPaginatedEnvelope<T> = {
  readonly data: readonly T[];
  readonly next_page?: {
    readonly offset?: string;
  } | null;
};

/**
 * Collects pages using Asana's offset-based pagination.
 * Stops when no more pages or when `maxItems` is reached.
 */
export async function paginate<T>(
  path: string,
  query: QueryParams = {},
  maxItems?: number,
): Promise<T[]> {
  const all: T[] = [];
  let offset: string | undefined;

  do {
    const pageQuery: QueryParams = offset === undefined
      ? query
      : { ...query, offset };

    const res = await api<readonly T[]>("GET", path, { query: pageQuery }) as AsanaPaginatedEnvelope<T>;
    const chunk = Array.isArray(res.data) ? res.data : [];

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
