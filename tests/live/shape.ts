/**
 * Safe response-shape summarizer for gradually strengthening provisional (auto-parsed)
 * response types against a real iCarry tenant.
 *
 * It records ONLY structural information — value KINDS and object property KEYS — and NEVER any
 * value: no ids, names, addresses, emails, phone numbers, tracking numbers, tokens, card data,
 * or full response bodies. Maintainers can run the (env-gated) live tests and log these
 * summaries to learn the real schema of provisional endpoints without capturing customer data,
 * then tighten the SDK's `AmbiguousApiResult`-typed methods over time.
 */

export type ValueKind = 'null' | 'undefined' | 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ShapeSummary {
  kind: ValueKind;
  /** For arrays: number of elements. */
  length?: number;
  /** For arrays: the distinct element kinds present. */
  elements?: ValueKind[];
  /** For objects: property name → value kind (keys are schema identifiers, never values). */
  keys?: Record<string, ValueKind>;
}

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

/** Returns a value-free structural summary of `value` (see module docs). */
export function summarizeShape(value: unknown): ShapeSummary {
  const kind = kindOf(value);
  if (kind === 'array') {
    const arr = value as unknown[];
    const elements = [...new Set(arr.map(kindOf))].sort();
    return { kind, length: arr.length, elements };
  }
  if (kind === 'object') {
    const keys: Record<string, ValueKind> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      keys[key] = kindOf(val);
    }
    return { kind, keys };
  }
  return { kind };
}
