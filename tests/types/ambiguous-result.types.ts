/**
 * Compile-time type tests for {@link AmbiguousApiResult}.
 *
 * Type-checked (never executed) via `npm run test:types`. This file MUST compile cleanly; the
 * `@ts-expect-error` lines guarantee a caller cannot treat an ambiguous result as an object or
 * array without narrowing. If the ambiguous result types are ever wrongly re-narrowed to an
 * object, those directives become unused and `tsc` fails.
 */
import type {
  AmbiguousApiResult,
  MerchantRateResult,
  MerchantOrderResult,
  MarketplaceRateResult,
  MarketplaceOrderResult,
  OnDemandRateResult,
  OnDemandShipmentResult,
  TrackingResult,
  CancelResult,
  PaymentResult,
} from '../../src';

declare const result: AmbiguousApiResult;

/** A caller must handle every runtime shape the parser can produce. */
export function handleAll(r: AmbiguousApiResult): string {
  if (r === undefined) return 'empty';
  if (r === null) return 'null';
  if (typeof r === 'string') return r;
  if (typeof r === 'number' || typeof r === 'boolean') return String(r);
  if (Array.isArray(r)) return `array:${r.length}`;
  const value: unknown = r['anyKey']; // OK: narrowed to an object
  return typeof value;
}

// Every ambiguous resource result alias must be assignable to AmbiguousApiResult.
export const assignable: AmbiguousApiResult[] = [
  null as unknown as MerchantRateResult,
  null as unknown as MerchantOrderResult,
  null as unknown as MarketplaceRateResult,
  null as unknown as MarketplaceOrderResult,
  null as unknown as OnDemandRateResult,
  null as unknown as OnDemandShipmentResult,
  null as unknown as TrackingResult,
  null as unknown as CancelResult,
  null as unknown as PaymentResult,
];

// A string result is representable.
export const asString: string = typeof result === 'string' ? result : '';
// An undefined (empty) result is representable.
export const isEmpty: boolean = result === undefined;

// --- The following MUST NOT compile (assuming an object shape without narrowing) ---

// @ts-expect-error indexing an ambiguous result without narrowing is unsafe
export const bad1 = result['field'];

// @ts-expect-error calling an array method without narrowing is unsafe
export const bad2 = result.map((x: unknown) => x);

// @ts-expect-error property access without narrowing is unsafe
export const bad3 = result.length;
