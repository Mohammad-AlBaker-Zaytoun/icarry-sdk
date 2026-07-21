/**
 * URL construction helpers: base-URL normalization, path-parameter encoding, and joining,
 * plus low-level path validation and metadata-safe path sanitization.
 *
 * @packageDocumentation
 */

import { ICarryConfigurationError } from '../errors';
import { API_PREFIX } from '../constants';

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

/** Decodes a path segment up to `maxRounds` times, returning every intermediate form. */
function decodedForms(segment: string, maxRounds = 2): string[] {
  const forms = [segment];
  let current = segment;
  for (let i = 0; i < maxRounds; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) {
      break;
    }
    forms.push(decoded);
    current = decoded;
  }
  return forms;
}

/**
 * Stricter validation for the low-level escape hatch. In addition to
 * {@link validateRelativePath}'s checks (non-empty, no absolute URL, no query/fragment, no
 * control chars), rejects backslashes and `.`/`..` path segments in literal, percent-encoded,
 * and double-encoded forms — preventing traversal that URL normalization could otherwise
 * resolve outside the `/api-frontend` prefix.
 */
export function validateRelativeApiPath(path: unknown): PathValidation {
  const base = validateRelativePath(path);
  if (!base.ok) {
    return base;
  }
  const value = path as string;
  if (value.includes('\\') || /%5c/i.test(value)) {
    return { ok: false, reason: 'path must not contain backslashes.' };
  }
  for (const rawSegment of value.split('/')) {
    for (const form of decodedForms(rawSegment)) {
      const normalized = form.toLowerCase();
      if (normalized === '.' || normalized === '..') {
        return { ok: false, reason: 'path must not contain "." or ".." segments.' };
      }
      if (normalized.includes('\\')) {
        return { ok: false, reason: 'path must not contain backslashes.' };
      }
    }
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

/** Hosts for which plain `http` is permitted (local development only). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/**
 * Counts non-overlapping occurrences of the API-prefix segment sequence inside a URL path,
 * matching **whole path segments** case-insensitively. Segment-aware (not a substring count),
 * so `/my-api-frontend-proxy` does NOT match `/api-frontend`, while `/api-frontend/api-frontend`
 * counts 2. Empty segments and trailing slashes are ignored.
 */
function countApiPrefixOccurrences(pathname: string, apiPrefix: string): number {
  const prefixSegs = apiPrefix
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  if (prefixSegs.length === 0) {
    return 0;
  }
  const segs = pathname
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  let count = 0;
  for (let i = 0; i + prefixSegs.length <= segs.length;) {
    let match = true;
    for (let j = 0; j < prefixSegs.length; j += 1) {
      if (segs[i + j] !== prefixSegs[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      count += 1;
      i += prefixSegs.length;
    } else {
      i += 1;
    }
  }
  return count;
}

/**
 * Strictly validates and canonicalizes a configured `baseUrl` using the WHATWG `URL` parser
 * (never a bare regex). Returns `scheme://host[:port][/path]` with **no** credentials, query
 * string, or fragment. `http` is allowed only for local hosts; all remote hosts must use
 * `https`. Rejects non-strings, empty/relative/protocol-relative URLs, embedded credentials,
 * query/hash, control characters, backslashes, unsupported protocols, and origin drift.
 *
 * @throws {@link ICarryConfigurationError} on any unsafe or invalid input.
 */
export function validateAndNormalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ICarryConfigurationError('baseUrl is required and must be a non-empty string.');
  }
  // Check the ORIGINAL string first: raw.trim() would strip CR/LF/tab, silently accepting
  // e.g. "\nhttps://host\r\n". Only ordinary spaces (0x20) may be trimmed. hasControlChar
  // rejects CR, LF, NUL, DEL, tab (0x09), and all other C0 controls.
  if (hasControlChar(raw)) {
    throw new ICarryConfigurationError('baseUrl must not contain control characters.');
  }
  const trimmed = raw.trim();
  if (trimmed.includes('\\')) {
    throw new ICarryConfigurationError('baseUrl must not contain backslashes.');
  }
  if (trimmed.startsWith('//')) {
    throw new ICarryConfigurationError(
      'baseUrl must not be protocol-relative; provide an absolute http(s) URL.'
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ICarryConfigurationError('baseUrl must be a valid absolute http(s) URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ICarryConfigurationError(
      `baseUrl protocol must be http or https (got "${url.protocol.replace(/:$/, '')}").`
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new ICarryConfigurationError(
      'baseUrl must not contain embedded credentials (username/password).'
    );
  }
  if (url.search !== '') {
    throw new ICarryConfigurationError('baseUrl must not contain a query string.');
  }
  if (url.hash !== '') {
    throw new ICarryConfigurationError('baseUrl must not contain a fragment.');
  }
  if (url.hostname === '') {
    throw new ICarryConfigurationError('baseUrl must include a host.');
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw new ICarryConfigurationError(
      'baseUrl must use https for non-local hosts (http is allowed only for localhost, 127.0.0.1, and [::1]).'
    );
  }
  if (countApiPrefixOccurrences(url.pathname, API_PREFIX) > 1) {
    throw new ICarryConfigurationError('baseUrl must contain the API prefix at most once.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  const canonical = `${url.origin}${path}`;
  let check: URL;
  try {
    check = new URL(canonical);
  } catch {
    throw new ICarryConfigurationError('baseUrl could not be safely normalized.');
  }
  if (check.origin !== url.origin) {
    throw new ICarryConfigurationError(
      'baseUrl origin changed after normalization; refusing to use it.'
    );
  }
  return canonical;
}

/**
 * Resolves the effective API root (`origin` + the `/api-frontend` prefix, added at most once)
 * as a `URL`, verifying the origin is unchanged and there is no query/fragment. Shared by
 * config validation and the transport's prefix-containment check so normalization never
 * diverges.
 *
 * @throws {@link ICarryConfigurationError} if the API root cannot be resolved safely.
 */
export function resolveApiRoot(baseUrl: string, apiPrefix: string = API_PREFIX): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ICarryConfigurationError('baseUrl could not be parsed into an API root.');
  }
  if (countApiPrefixOccurrences(base.pathname, apiPrefix) > 1) {
    throw new ICarryConfigurationError('baseUrl must contain the API prefix at most once.');
  }
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
  const basePath = base.pathname.replace(/\/+$/, '');
  const rootPath = basePath.toLowerCase().endsWith(prefix.toLowerCase())
    ? basePath
    : `${basePath}${prefix}`;
  let root: URL;
  try {
    root = new URL(`${base.origin}${rootPath}`);
  } catch {
    throw new ICarryConfigurationError('Could not resolve a safe API root URL.');
  }
  if (root.origin !== base.origin || root.search !== '' || root.hash !== '') {
    throw new ICarryConfigurationError(
      'Resolved API root is unsafe (origin/query/fragment mismatch).'
    );
  }
  return root;
}

/**
 * Defense-in-depth: returns a display-safe base URL (`scheme://host[:port][/path]`) with any
 * credentials, query string, and fragment removed. Idempotent for already-canonical input.
 * Used by the public client inspection methods so an unsafe value could never leak even if
 * configuration validation were bypassed.
 */
export function sanitizeBaseUrlForDisplay(value: string): string {
  try {
    const u = new URL(value);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    const beforeHash = value.split('#', 1)[0] ?? value;
    const beforeQuery = beforeHash.split('?', 1)[0] ?? beforeHash;
    return stripControlChars(beforeQuery.trim());
  }
}
