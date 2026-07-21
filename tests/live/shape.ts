/**
 * Safe response-shape summarizer for gradually strengthening provisional (auto-parsed)
 * response types against a real iCarry tenant.
 *
 * It records ONLY structural information — value KINDS, a coarse size BUCKET, and *sanitized*
 * object property names — and NEVER any value. Property names are NOT assumed to be schema
 * identifiers: some APIs return dictionary-like objects keyed by emails, phone numbers,
 * tracking/order ids, tokens, or card-like strings. Every key is therefore passed through
 * {@link sanitizeShapeKey}, which replaces anything that looks dynamic or sensitive with a
 * category label (e.g. `[email-key]`). Exact array/object sizes are bucketed, never emitted.
 * Values, nested contents, ids, addresses, emails, phone numbers, tracking numbers, tokens,
 * card data, and full bodies never appear in a summary.
 */

export type ValueKind = 'null' | 'undefined' | 'string' | 'number' | 'boolean' | 'array' | 'object';

/** Coarse size bucket used instead of an exact length/count. */
export type SizeBucket = 'empty' | 'one' | 'few' | 'many';

export interface ShapeSummary {
  kind: ValueKind;
  /** Coarse size bucket for arrays/objects (never an exact count). */
  size?: SizeBucket;
  /** For arrays: the distinct element kinds present (capped). */
  elements?: ValueKind[];
  /** For objects: sanitized property name → value kind (keys categorized, never raw values). */
  keys?: Record<string, ValueKind>;
  /** True when keys/element-kinds were capped, so the summary is partial. */
  truncated?: boolean;
}

/** Hard caps so a hostile/huge payload cannot bloat or de-anonymize a summary. */
const MAX_KEYS = 40;
const MAX_KEY_LEN = 40;
const MAX_ELEMENT_KINDS = 8;

function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') {
    return t;
  }
  return 'string'; // functions/symbols/bigint are never expected in a JSON response
}

function sizeBucket(n: number): SizeBucket {
  if (n <= 0) return 'empty';
  if (n === 1) return 'one';
  if (n <= 10) return 'few';
  return 'many';
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_KEYWORD_RE =
  /bearer|secret|token|password|passwd|apikey|api[_-]?key|authorization|jwt|cvv|card/i;
const SAFE_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Maps a raw object key to a display-safe form. Schema-like identifiers (`id`, `name`,
 * `status`, `createdAt`, `countryId`, `trackingNumber`, …) are returned unchanged; anything
 * dynamic or sensitive is replaced with a category label so no value ever leaks through a key.
 */
export function sanitizeShapeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) return '[dynamic-key]';
  if (hasControlChar(key)) return '[dynamic-key]';
  if (key.length > MAX_KEY_LEN) return '[long-key]';
  if (key.includes('@')) return '[email-key]';
  if (key.includes('://')) return '[url-key]';
  if (TOKEN_KEYWORD_RE.test(key) && !SAFE_IDENTIFIER_RE.test(key)) return '[token-like-key]';
  if (UUID_RE.test(key)) return '[long-id-key]';

  const digitsOnly = key.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digitsOnly)) return '[numeric-key]'; // card-number-like
  if (/^\+?\d{7,15}$/.test(digitsOnly)) return '[phone-key]';
  if (/^\d{7,}$/.test(digitsOnly)) return '[numeric-key]'; // long numeric id

  if (SAFE_IDENTIFIER_RE.test(key)) return key; // schema-like identifier — safe to show
  return '[dynamic-key]'; // mixed/tracking/order-like or otherwise non-schema
}

/**
 * Returns a value-free, size-bucketed structural summary of `value` (see module docs). Does not
 * recurse into nested objects/arrays — nested contents are reported only as a kind — so circular
 * or deeply nested inputs cannot leak values or cause a stack overflow.
 */
export function summarizeShape(value: unknown): ShapeSummary {
  const kind = kindOf(value);

  if (kind === 'array') {
    const arr = value as unknown[];
    const allKinds = [...new Set(arr.map(kindOf))].sort();
    const elements = allKinds.slice(0, MAX_ELEMENT_KINDS);
    const summary: ShapeSummary = { kind, size: sizeBucket(arr.length), elements };
    if (allKinds.length > MAX_ELEMENT_KINDS) summary.truncated = true;
    return summary;
  }

  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const keys: Record<string, ValueKind> = {};
    let truncated = false;
    for (let i = 0; i < entries.length; i += 1) {
      if (i >= MAX_KEYS) {
        truncated = true;
        break;
      }
      const entry = entries[i];
      if (!entry) continue;
      keys[sanitizeShapeKey(entry[0])] = kindOf(entry[1]);
    }
    const summary: ShapeSummary = { kind, size: sizeBucket(entries.length), keys };
    if (truncated) summary.truncated = true;
    return summary;
  }

  return { kind };
}
