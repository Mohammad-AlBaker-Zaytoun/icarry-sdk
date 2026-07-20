/**
 * URL construction helpers: base-URL normalization, path-parameter encoding, and joining.
 *
 * @packageDocumentation
 */

/**
 * Normalizes a configured base URL: trims surrounding whitespace and removes any trailing
 * slashes. Does not validate the scheme (that is the config layer's job) beyond trimming.
 *
 * @example normalizeBaseUrl('https://test.icarry.com/') // 'https://test.icarry.com'
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Encodes a single path parameter for safe interpolation into a URL path.
 *
 * @example encodePathParam('a/b 1') // 'a%2Fb%201'
 */
export function encodePathParam(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Joins a base URL, the API prefix, and a relative path into a full URL.
 *
 * Idempotent with respect to the prefix: if `baseUrl` already ends with `apiPrefix`
 * (e.g. the caller passed `https://host/api-frontend`), the prefix is not added twice.
 *
 * @param baseUrl - Origin, optionally already including the API prefix.
 * @param apiPrefix - The API path prefix, e.g. `/api-frontend`.
 * @param path - The endpoint path (leading slash optional).
 */
export function joinPath(baseUrl: string, apiPrefix: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
  const withPrefix = base.toLowerCase().endsWith(prefix.toLowerCase()) ? base : `${base}${prefix}`;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${withPrefix}${suffix}`;
}
