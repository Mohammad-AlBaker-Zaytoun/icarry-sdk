/**
 * Safe response-shape summarizer for gradually strengthening provisional (auto-parsed)
 * response types against a real iCarry tenant.
 *
 * It records ONLY structural information — value KINDS, a coarse size BUCKET, and *sanitized*
 * object property names — and NEVER any value. Property names are NOT assumed to be safe schema
 * identifiers. A conservative policy is applied to every key:
 *   1. Sensitive-keyword matches (token/secret/password/bearer/jwt/apiKey/privateKey/card/pan/
 *      cvv/…) are masked as `[token-like-key]` EVEN when they are otherwise identifier-shaped
 *      (e.g. `BearerSecretToken`, `apiKeySecretValue`, `SUPERSECRETTOKEN`), unless the key is on a
 *      small explicit safe-schema allowlist.
 *   2. Structural detectors mask emails, URLs, phone/card/long-numeric, UUIDs, and over-long or
 *      control-bearing keys with category labels.
 *   3. Only then are remaining plain identifiers shown as-is.
 * Keys are aggregated per sanitized category as a set of value kinds, so two raw keys that map to
 * the same category (e.g. two emails) cannot overwrite each other's structural kind and no raw key
 * is ever emitted. Sizes are bucketed, never exact. Values, nested contents, ids, addresses,
 * emails, phone numbers, tracking numbers, tokens, card data, and full bodies never appear.
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
  /** For objects: sanitized category → the distinct value kinds seen under it (aggregated). */
  keys?: Record<string, ValueKind[]>;
  /** True when categories/element-kinds were capped, so the summary is partial. */
  truncated?: boolean;
}

/** Hard caps so a hostile/huge payload cannot bloat or de-anonymize a summary. */
const MAX_KEYS = 40;
const MAX_KEY_LEN = 40;
const MAX_ELEMENT_KINDS = 8;

/**
 * Small, deliberately conservative allowlist of keys that are safe to show verbatim even if they
 * happened to match a sensitive keyword. Intentionally narrow — expand only with clear need.
 */
const SAFE_SCHEMA_KEYS = new Set([
  'id',
  'name',
  'status',
  'createdAt',
  'updatedAt',
  'countryId',
  'stateId',
  'warehouseId',
  'shipmentId',
  'trackingNumber',
  'type',
  'code',
  'message',
  'active',
  'items',
  'data',
  'result',
]);

/**
 * Sensitive keyword fragments. Case-insensitive substring match, so combined camelCase/UPPERCASE
 * identifier-shaped secrets (e.g. `BearerSecretToken`, `APIKEYSECRETVALUE`, `privateKeyMaterial`)
 * are caught. Broad by design — over-masking a key is safe; leaking one is not.
 */
const SENSITIVE_KEYWORD_RE =
  /token|secret|passwd|password|authorization|bearer|jwt|api[-_]?key|private[-_]?key|card|pan|cvv|cvc|security[-_]?code|session|cookie|credential/i;

/** A plain JavaScript-style identifier (shown verbatim only after sensitive filtering). */
const SAFE_SCHEMA_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Maps a raw object key to a display-safe category or (for confidently-safe plain identifiers)
 * itself. Sensitive-keyword matching runs BEFORE the generic identifier check so identifier-shaped
 * secrets can never leak.
 */
export function sanitizeShapeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) return '[dynamic-key]';
  if (hasControlChar(key)) return '[dynamic-key]';
  if (key.length > MAX_KEY_LEN) return '[long-key]';
  if (key.includes('@')) return '[email-key]';
  if (key.includes('://')) return '[url-key]';

  // Sensitive keywords are masked before the generic safe-identifier check — unless explicitly
  // allowlisted — so `BearerSecretToken`, `password123`, `apiKeySecretValue`, etc. are caught.
  if (SENSITIVE_KEYWORD_RE.test(key) && !SAFE_SCHEMA_KEYS.has(key)) {
    return '[token-like-key]';
  }

  if (UUID_RE.test(key)) return '[long-id-key]';
  const digitsOnly = key.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digitsOnly)) return '[numeric-key]'; // card-number-like
  if (/^\+?\d{7,15}$/.test(digitsOnly)) return '[phone-key]';
  if (/^\d{7,}$/.test(digitsOnly)) return '[numeric-key]'; // long numeric id

  if (SAFE_SCHEMA_KEY_RE.test(key)) return key; // plain identifier, no sensitive fragment
  return '[dynamic-key]';
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
    // Aggregate value kinds per sanitized category so collisions (e.g. two emails) don't overwrite
    // each other and no raw key or occurrence count is exposed.
    const byCategory = new Map<string, Set<ValueKind>>();
    let truncated = false;
    for (const [rawKey, val] of entries) {
      const category = sanitizeShapeKey(rawKey);
      let kinds = byCategory.get(category);
      if (!kinds) {
        if (byCategory.size >= MAX_KEYS) {
          truncated = true;
          break;
        }
        kinds = new Set<ValueKind>();
        byCategory.set(category, kinds);
      }
      kinds.add(kindOf(val));
    }
    const keys: Record<string, ValueKind[]> = {};
    for (const [category, kinds] of byCategory) {
      keys[category] = [...kinds].sort().slice(0, MAX_ELEMENT_KINDS);
    }
    const summary: ShapeSummary = { kind, size: sizeBucket(entries.length), keys };
    if (truncated) summary.truncated = true;
    return summary;
  }

  return { kind };
}
