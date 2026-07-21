/**
 * Redaction utilities.
 *
 * The SDK sanitizes known sensitive values (passwords, bearer tokens, card numbers, CVVs,
 * and URLs carrying such data) at every public logging and error boundary. Three entry
 * points share one set of sensitive-key definitions so redaction cannot diverge:
 *
 * - {@link redact} — structured values (objects/arrays), masked by key.
 * - {@link redactUrl} — a URL, masking sensitive query-parameter values.
 * - {@link redactString} — free-form text (error messages), masking embedded URLs, bearer
 *   tokens, `key=value`/`"key":"value"` fragments, and card-number-like digit runs.
 *
 * The SDK cannot control logging at the HTTP/infrastructure layer, nor protect original
 * input values a caller logs themselves.
 *
 * @packageDocumentation
 */

/** Options for {@link redact}. */
export interface RedactOptions {
  /** Also mask `email` fields (partial mask). Off by default. */
  redactEmail?: boolean;
  /** Maximum recursion depth before a subtree is collapsed. Defaults to 8. */
  maxDepth?: number;
  /** Also run {@link redactString} on string leaves (used for error details). Off by default. */
  sanitizeStrings?: boolean;
}

/** Placeholder substituted for fully-masked sensitive values. */
export const REDACTED = '[REDACTED]';

// --- Shared sensitive-key definitions (single source of truth) ---------------

/** Alternation of key names whose value must be fully masked. */
const SECRET_KEY_ALT =
  'password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|auth|secret|api[_-]?key|apikey|card[_-]?cvv2?|card[_-]?cvc2?|cvv2?|cvc2?|security[_-]?code|card[_-]?name|card[_-]?type|card[_-]?expiration[_-]?month|card[_-]?expiration[_-]?year|expiry|expiry[_-]?month|expiry[_-]?year|expiration[_-]?month|expiration[_-]?year';

/** Alternation of key names that hold a card number (masked to the last four digits). */
const CARD_NUMBER_ALT = 'card[_-]?number|cardnumber|pan|masked[_-]?credit[_-]?card[_-]?number';

const FULL_MASK_KEY = new RegExp(`^(?:${SECRET_KEY_ALT})$`, 'i');
const CARD_NUMBER_KEY = new RegExp(`^(?:${CARD_NUMBER_ALT})$`, 'i');
const EMAIL_KEY = /^e[-_]?mail$/i;
const SENSITIVE_QUERY_KEY = new RegExp(`^(?:${CARD_NUMBER_ALT}|${SECRET_KEY_ALT})$`, 'i');

const DEFAULT_MAX_DEPTH = 8;

/**
 * Masks a card number, preserving only the last four digits. Non-digit separators are
 * stripped before measuring length. Returns {@link REDACTED} if fewer than 4 digits.
 */
export function maskCardNumber(value: unknown): string {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) {
    return REDACTED;
  }
  const last4 = digits.slice(-4);
  return `************${last4}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function isBinaryLike(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
  );
}

function maskForKey(key: string, value: unknown, opts: Required<RedactOptions>): unknown {
  if (CARD_NUMBER_KEY.test(key)) {
    return maskCardNumber(value);
  }
  if (FULL_MASK_KEY.test(key)) {
    return REDACTED;
  }
  if (opts.redactEmail && EMAIL_KEY.test(key)) {
    return maskEmail(value);
  }
  return undefined; // sentinel: not a sensitive key
}

function maskEmail(value: unknown): string {
  const str = String(value);
  const at = str.indexOf('@');
  if (at <= 0) {
    return REDACTED;
  }
  const domain = str.slice(at);
  const head = str.slice(0, 1);
  return `${head}***${domain}`;
}

/**
 * Deeply clones `value`, masking sensitive fields by key (case-insensitive). Never
 * mutates the input. Does not recurse into binary data or class instances (those are
 * replaced with a safe tag), and is cycle- and depth-safe. With `sanitizeStrings`, string
 * leaves are additionally passed through {@link redactString}.
 */
export function redact<T>(value: T, opts?: RedactOptions): T {
  const resolved: Required<RedactOptions> = {
    redactEmail: opts?.redactEmail ?? false,
    maxDepth: opts?.maxDepth ?? DEFAULT_MAX_DEPTH,
    sanitizeStrings: opts?.sanitizeStrings ?? false,
  };
  return redactInner(value, resolved, 0, new WeakSet<object>()) as T;
}

function redactInner(
  value: unknown,
  opts: Required<RedactOptions>,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null || typeof value !== 'object') {
    if (opts.sanitizeStrings && typeof value === 'string') {
      return redactString(value);
    }
    return value;
  }
  if (isBinaryLike(value)) {
    return '[binary]';
  }
  if (depth >= opts.maxDepth) {
    return '[truncated]';
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, opts, depth + 1, seen));
  }

  if (!isPlainObject(value)) {
    // Dates, Maps, class instances, etc. — do not risk leaking internals.
    return `[${(value as object).constructor?.name ?? 'object'}]`;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const masked = maskForKey(key, val, opts);
    out[key] = masked !== undefined ? masked : redactInner(val, opts, depth + 1, seen);
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Returns `url` with the values of any sensitive query parameters (card number, CVV,
 * expiry, cardholder name/type, tokens, …) replaced by `REDACTED`. Works on both absolute
 * and relative URLs and never throws. The path and non-sensitive parameters are preserved.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }
  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const [rawQuery = '', ...hashParts] = query.split('#');
  const hash = hashParts.length > 0 ? `#${hashParts.join('#')}` : '';

  const redactedQuery = rawQuery
    .split('&')
    .map((pair) => {
      if (pair === '') {
        return pair;
      }
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const key = safeDecode(rawKey);
      if (SENSITIVE_QUERY_KEY.test(key)) {
        return `${rawKey}=${REDACTED}`;
      }
      return pair;
    })
    .join('&');

  return `${path}?${redactedQuery}${hash}`;
}

// --- Free-form string sanitization ------------------------------------------

const EMBEDDED_URL_RE = /https?:\/\/[^\s"'<>()\\]+/gi;
const BEARER_RE = /\bBearer\s+[^\s"'<>]+/gi;
const SENSITIVE_KV_RE = new RegExp(
  `\\b(${SECRET_KEY_ALT}|${CARD_NUMBER_ALT})\\b(\\s*["']?\\s*[:=]\\s*["']?)([^\\s"'&,;}]+)`,
  'gi'
);
const LONG_DIGITS_RE = /\d{13,19}/g;

/**
 * Sanitizes free-form text (typically an error message) that may embed sensitive values.
 * Masks, in order: embedded URLs' sensitive query params, `Bearer <token>`, sensitive
 * `key=value` / `"key":"value"` fragments, and 13–19 digit runs that resemble card numbers.
 * Never throws; returns the input unchanged when it contains nothing sensitive.
 */
export function redactString(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  let out = value;
  out = out.replace(EMBEDDED_URL_RE, (match) => redactUrl(match));
  out = out.replace(BEARER_RE, 'Bearer [REDACTED]');
  out = out.replace(SENSITIVE_KV_RE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  out = out.replace(LONG_DIGITS_RE, (digits) => maskCardNumber(digits));
  return out;
}

/**
 * Produces a safe, minimal `Error` from an arbitrary thrown value, retaining only a name, a
 * {@link redactString}-sanitized message, and a safe `code` (string/number). It never
 * retains the original error object, its custom properties, request objects, URLs, headers,
 * bodies, or its (potentially sensitive) stack. Returns `undefined` for nullish input.
 */
export function sanitizeErrorCause(error: unknown): Error | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }
  if (error instanceof Error) {
    const name = typeof error.name === 'string' && error.name.length > 0 ? error.name : 'Error';
    const message = typeof error.message === 'string' ? redactString(error.message) : '';
    const safe = new Error(message);
    safe.name = name;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
      Object.defineProperty(safe, 'code', { value: code, enumerable: true, configurable: true });
    }
    return safe;
  }
  let text: string;
  try {
    text = typeof error === 'string' ? error : String(error);
  } catch {
    text = 'Unknown error';
  }
  return new Error(redactString(text));
}
