/**
 * Redaction utilities.
 *
 * The SDK must never surface passwords, bearer tokens, card numbers, CVVs, or URLs
 * carrying card data — not in errors, not in logs, not in observability hooks. Every
 * such boundary funnels through {@link redact} (for structured values) and
 * {@link redactUrl} (for request URLs).
 *
 * @packageDocumentation
 */

/** Options for {@link redact}. */
export interface RedactOptions {
  /** Also mask `email` fields (partial mask). Off by default. */
  redactEmail?: boolean;
  /** Maximum recursion depth before a subtree is collapsed. Defaults to 8. */
  maxDepth?: number;
}

/** Placeholder substituted for fully-masked sensitive values. */
export const REDACTED = '[REDACTED]';

/** Keys whose value must be fully masked. */
const FULL_MASK_KEY =
  /^(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|auth|secret|api[_-]?key|apikey|card[_-]?cvv2?|card[_-]?cvc2?|cvv2?|cvc2?|security[_-]?code|card[_-]?name|card[_-]?type|card[_-]?expiration[_-]?month|card[_-]?expiration[_-]?year|expiry|expiry[_-]?month|expiry[_-]?year|expiration[_-]?month|expiration[_-]?year)$/i;

/** Keys that hold a card number — masked to keep only the last four digits. */
const CARD_NUMBER_KEY =
  /^(?:card[_-]?number|cardnumber|pan|masked[_-]?credit[_-]?card[_-]?number)$/i;

/** Email keys — masked only when {@link RedactOptions.redactEmail} is enabled. */
const EMAIL_KEY = /^e[-_]?mail$/i;

/** Query-parameter names considered sensitive by {@link redactUrl}. */
const SENSITIVE_QUERY_KEY =
  /^(?:card[_-]?number|cardnumber|pan|card[_-]?cvv2?|card[_-]?cvc2?|cvv2?|cvc2?|security[_-]?code|card[_-]?name|card[_-]?type|card[_-]?expiration[_-]?month|card[_-]?expiration[_-]?year|password|token|authorization|secret|api[_-]?key)$/i;

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
  const name = str.slice(0, at);
  const domain = str.slice(at);
  const head = name.slice(0, 1);
  return `${head}***${domain}`;
}

/**
 * Deeply clones `value`, masking sensitive fields by key (case-insensitive). Never
 * mutates the input. Does not recurse into binary data or class instances (those are
 * replaced with a safe tag), and is cycle- and depth-safe.
 */
export function redact<T>(value: T, opts?: RedactOptions): T {
  const resolved: Required<RedactOptions> = {
    redactEmail: opts?.redactEmail ?? false,
    maxDepth: opts?.maxDepth ?? DEFAULT_MAX_DEPTH,
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
