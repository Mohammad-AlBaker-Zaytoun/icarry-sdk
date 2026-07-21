/**
 * URL construction helpers: base-URL normalization, path-parameter encoding, and joining,
 * plus low-level path validation and metadata-safe path sanitization.
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

/** Whether a string contains any ASCII control character (0x00-0x1F or 0x7F). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Returns `value` with any ASCII control characters removed. */
function stripControlChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) {
      out += value[i];
    }
  }
  return out;
}

/** Result of {@link validateRelativePath}. */
export interface PathValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validates that a low-level request path is a safe relative path: a non-empty string with
 * no query string, no fragment, no absolute URL, and no control characters. Callers must
 * pass query parameters via the `query` option, not baked into the path.
 */
export function validateRelativePath(path: unknown): PathValidation {
  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, reason: 'path must be a non-empty string.' };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('//')) {
    return { ok: false, reason: 'path must be relative to the API base, not an absolute URL.' };
  }
  if (path.includes('?')) {
    return {
      ok: false,
      reason: 'path must not include a query string; use the query option instead.',
    };
  }
  if (path.includes('#')) {
    return { ok: false, reason: 'path must not include a fragment.' };
  }
  if (hasControlChar(path)) {
    return { ok: false, reason: 'path must not contain control characters.' };
  }
  return { ok: true };
}

/**
 * Strips any query string and fragment from a path so it is safe to place in error details
 * and observability metadata, even if an internal caller violated the path contract. Also
 * removes control characters defensively.
 */
export function sanitizePathForMetadata(path: string): string {
  let out = path;
  const hash = out.indexOf('#');
  if (hash !== -1) {
    out = out.slice(0, hash);
  }
  const query = out.indexOf('?');
  if (query !== -1) {
    out = out.slice(0, query);
  }
  return stripControlChars(out);
}
