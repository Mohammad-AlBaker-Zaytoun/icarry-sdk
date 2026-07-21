/**
 * Safe response-shape summarizer for gradually strengthening provisional (auto-parsed)
 * response types against a real iCarry tenant.
 *
 * It records ONLY structural information — value KINDS, a coarse size BUCKET, and *sanitized*
 * object property categories — and NEVER any value. It is a **defense-in-depth helper for optional
 * live tests, not a formal anonymizer** and makes no PCI/PII-detection guarantee.
 *
 * Key policy (conservative):
 *   - **Only keys on a small explicit allowlist may appear verbatim.** Every other property key is
 *     replaced by a structural category (`[email-key]`, `[token-like-key]`, `[dynamic-key]`, …).
 *     Arbitrary identifier-shaped keys (customer names, ids, references) are therefore NOT shown.
 *   - Value kinds are aggregated per category, so colliding keys can't overwrite each other's kind.
 *   - Raw property processing is capped (`MAX_RAW_KEYS`) independently of the distinct-category cap
 *     (`MAX_CATEGORIES`), iterating own enumerable keys only — so a huge object (e.g. 100k keys that
 *     all map to one category) is bounded and flagged `truncated`.
 *   - Sizes are coarse buckets, never exact counts. Values, nested contents, raw non-allowlisted
 *     keys, and exact property/category counts never appear.
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
  /** True when raw-property, category, or element-kind caps were hit, so the summary is partial. */
  truncated?: boolean;
}

/** Hard caps so a hostile/huge payload cannot bloat, slow, or de-anonymize a summary. */
const MAX_RAW_KEYS = 200; // raw own-properties processed, regardless of how they collapse
const MAX_CATEGORIES = 40; // distinct sanitized categories retained
const MAX_KEY_LEN = 40;
const MAX_ELEMENT_KINDS = 8;
/** Bounded object-size counter — never counts past the `many` threshold. */
const SIZE_COUNT_CAP = 11;

/**
 * Small, deliberately conservative allowlist — the ONLY keys shown verbatim. Everything not here is
 * categorized. Do NOT add customer names, arbitrary identifiers, or business-specific fields.
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
 * Maps a raw object key to a display-safe category, or to itself ONLY when it is on the explicit
 * {@link SAFE_SCHEMA_KEYS} allowlist. Arbitrary identifiers (`CustomerABC123`, `MohammadZaytoun`,
 * `OrderReferenceXYZ`, …) are categorized as `[dynamic-key]`, never shown verbatim.
 */
export function sanitizeShapeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) return '[dynamic-key]';
  if (hasControlChar(key)) return '[dynamic-key]';
  if (key.length > MAX_KEY_LEN) return '[long-key]';
  if (key.includes('@')) return '[email-key]';
  if (key.includes('://')) return '[url-key]';
  if (SENSITIVE_KEYWORD_RE.test(key)) return '[token-like-key]';
  if (UUID_RE.test(key)) return '[long-id-key]';

  const digitsOnly = key.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digitsOnly)) return '[numeric-key]'; // card-number-like
  if (/^\+?\d{7,15}$/.test(digitsOnly)) return '[phone-key]';
  if (/^\d{7,}$/.test(digitsOnly)) return '[numeric-key]'; // long numeric id

  if (SAFE_SCHEMA_KEYS.has(key)) return key; // ONLY allowlisted keys are shown verbatim
  return '[dynamic-key]';
}

/**
 * Returns a value-free, size-bucketed structural summary of `value` (see module docs). Does not
 * recurse into nested objects/arrays — nested contents are reported only as a kind — so circular
 * or deeply nested inputs cannot leak values or cause a stack overflow. Object processing is
 * bounded by {@link MAX_RAW_KEYS} raw own-properties and {@link MAX_CATEGORIES} categories.
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
    const object = value as Record<string, unknown>;
    // Aggregate value kinds per sanitized category. Iterate own enumerable keys incrementally
    // (never Object.entries) so a huge object is bounded by MAX_RAW_KEYS regardless of how many
    // distinct categories it collapses into.
    const byCategory = new Map<string, Set<ValueKind>>();
    let truncated = false;
    let processed = 0;
    let observed = 0; // bounded object-size counter (never exceeds SIZE_COUNT_CAP)

    for (const rawKey in object) {
      if (!Object.prototype.hasOwnProperty.call(object, rawKey)) continue;
      if (processed >= MAX_RAW_KEYS) {
        truncated = true;
        break;
      }
      processed += 1;
      if (observed < SIZE_COUNT_CAP) observed += 1;

      const category = sanitizeShapeKey(rawKey);
      let kinds = byCategory.get(category);
      if (!kinds) {
        if (byCategory.size >= MAX_CATEGORIES) {
          truncated = true;
          break;
        }
        kinds = new Set<ValueKind>();
        byCategory.set(category, kinds);
      }
      kinds.add(kindOf(object[rawKey]));
    }

    const keys: Record<string, ValueKind[]> = {};
    for (const [category, kinds] of byCategory) {
      keys[category] = [...kinds].sort().slice(0, MAX_ELEMENT_KINDS);
    }
    const summary: ShapeSummary = { kind, size: sizeBucket(observed), keys };
    if (truncated) summary.truncated = true;
    return summary;
  }

  return { kind };
}
