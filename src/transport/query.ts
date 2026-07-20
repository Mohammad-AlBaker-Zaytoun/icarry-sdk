/**
 * Query-string construction.
 *
 * @packageDocumentation
 */

/** A single query value. `null`/`undefined` are omitted entirely. */
export type QueryValue = string | number | boolean | null | undefined;

/** Query parameters. Array values repeat the key (`?k=a&k=b`). */
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

/**
 * Builds an encoded query string (including the leading `?`) from a params record.
 * Returns an empty string when there are no effective parameters. `null`/`undefined`
 * values — and array elements — are skipped; booleans serialize as `true`/`false`.
 *
 * @example buildQuery({ name: 'a b', addSelectStateItem: true }) // '?name=a+b&addSelectStateItem=true'
 */
export function buildQuery(params?: QueryParams): string {
  if (!params) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (raw === null || raw === undefined) {
      continue;
    }
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === null || value === undefined) {
        continue;
      }
      search.append(key, String(value));
    }
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}
