/**
 * Marketplace shipping resource. The wire model is identical to the merchant model plus a
 * `pickupLocation` (the warehouse/pickup name). Uses `MethodId` and `COdCurrency` like the
 * merchant flow. (Marketplace *warehouse* creation lives on `client.warehouses`.)
 *
 * Rate/order responses stay `AmbiguousApiResult`. {@link parseMarketplaceRates} offers an
 * **opt-in**, provisional reading of the rate response without narrowing the method's type —
 * see {@link MarketplaceRateOption} for why it is opt-in.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ICarryApiError } from '../errors';
import { ENDPOINTS } from '../constants';
import type { AmbiguousApiResult, GeoPoint, RequestOptions } from '../types';
import { readWireField, toRequestFields, requireNonEmptyString, unwrapWireList } from './_shared';
import {
  type MerchantRateInput,
  type MerchantCreateOrderInput,
  toWireRateBody,
  toWireMerchantCreateOrder,
  validateRateBody,
  validateMerchantCreateOrder,
} from './merchant';

/**
 * Input for {@link MarketplaceResource.estimateRates} (merchant rate model + pickup).
 *
 * Unlike the merchant model, `to` is **optional** here. iCarry's docs label the coordinates
 * mandatory, but on `lb.icarry.com` (2026-10-15) the endpoint priced a body with **no**
 * `ToLatitude`/`ToLongitude` from the carrier's own city name (`dropOffLocation` and
 * `dropAddress.city` set to a name from `countries.listStates`), and answered an unknown name
 * with HTTP 404 `Unsupported City` — see {@link isUnsupportedCityError}. Omit `to` rather than
 * inventing a point: `(0, 0)` or a default city centre would be a fabricated destination.
 * When `to` is supplied it is validated and sent exactly as before.
 */
export interface MarketplaceRateInput extends Omit<MerchantRateInput, 'to'> {
  /** Warehouse / pickup-location name, as listed under "My locations". */
  pickupLocation: string;
  /**
   * Recipient coordinates → wire `ToLongitude`/`ToLatitude`. Optional: when omitted, both
   * keys are left out of the body and iCarry prices from the city name.
   */
  to?: GeoPoint;
}

/** Input for {@link MarketplaceResource.createOrder} (merchant order model + pickup). */
export interface MarketplaceCreateOrderInput extends MerchantCreateOrderInput {
  pickupLocation: string;
}

/** Unverified rate-estimation result — returned as received. */
export type MarketplaceRateResult = AmbiguousApiResult;
/** Unverified order-creation result — returned as received. */
export type MarketplaceOrderResult = AmbiguousApiResult;

/**
 * One shipping option from `EstimateRatesForMarketplace`, as mapped by
 * {@link parseMarketplaceRates}.
 *
 * **Provisional — opt-in, not the method's return type.** This shape comes from a *single* live
 * observation against one tenant (2026-07-30). Per the response-typing policy in
 * API_COVERAGE.md that is not enough to narrow {@link MarketplaceRateResult}, so
 * `estimateRates` still returns {@link AmbiguousApiResult} and you opt into this structure by
 * calling the parser. If iCarry's shape differs on your tenant, the parser yields `[]` and you
 * still have the raw result.
 *
 * Only fields whose type could be inferred with confidence are modeled; everything the endpoint
 * sent — including `Finance`, `MethodBodyInfo`, `CarrierModel`, `CustomProperties` and the
 * carrier type ids — is preserved verbatim on {@link MarketplaceRateOption.raw}.
 */
export interface MarketplaceRateOption {
  /**
   * Wire `ShippingRateComputationMethodSystemName` → `provider` on
   * {@link MarketplaceResource.createOrder}.
   */
  systemShipmentProvider: string;
  /** Wire `MethodId` → `methodId` on {@link MarketplaceResource.createOrder}. */
  methodId: number | string;
  /**
   * Wire `Rate` — the **numeric** price (e.g. `2.121`) → `price` on
   * {@link MarketplaceResource.createOrder}. Use this, never {@link formattedPrice}.
   */
  rate: number;
  /** Wire `Description` → `methodDescription` on {@link MarketplaceResource.createOrder}. */
  description?: string;
  /**
   * Wire `Price` — a **display string** such as `"$2.12"`, already currency-formatted and
   * rounded. For rendering only: sending it to `createOrder`'s numeric `Price` field is the
   * mistake this interface exists to prevent. Use {@link rate} instead.
   */
  formattedPrice?: string;
  /** Wire `MethodName`. */
  methodName?: string;
  /** Wire `LocalizedMethodName`. */
  localizedMethodName?: string;
  /** Wire `Name`. */
  name?: string;
  /** Wire `DisplayOrder`. */
  displayOrder?: number;
  /** Wire `Selected` — whether iCarry pre-selects this option. */
  selected?: boolean;
  /** Wire `CODCurrency` — a currency code, read from a bare string or `{ CurrencyCode }`. */
  codCurrency?: string;
  /**
   * Wire `WorkingCurrency` — the currency `rate` is denominated in, as a code (`"USD"`).
   * Live `lb.icarry.com` responses send an **object** (`{ CurrencyCode: "USD", Name: "US
   * Dollar", … }`), not a string; both forms yield the code here. The full object stays on
   * {@link raw}.
   */
  workingCurrency?: string;
  /** The option exactly as received, including fields this interface does not model. */
  raw: Record<string, unknown>;
}

/**
 * `true` when a rate call failed because iCarry does not recognise the destination city: an
 * {@link ICarryApiError} whose message reads `Unsupported City` (observed live as HTTP 404 on
 * `lb.icarry.com`, 2026-10-15, for a name not in the state list).
 *
 * The fix is to send a name exactly as `countries.listStates()` returns it — not to retry, and
 * not to fall back to coordinates. Any other error → `false`.
 */
export function isUnsupportedCityError(error: unknown): boolean {
  return error instanceof ICarryApiError && /\bunsupported\s+city\b/i.test(error.message);
}

/** Reads a wire string, refusing to stringify objects/numbers into a fake value. */
function wireString(wire: Record<string, unknown>, ...keys: string[]): string | undefined {
  const value = readWireField(wire, ...keys);
  return typeof value === 'string' ? value : undefined;
}

/** Reads a wire number, accepting a numeric string but never a formatted one (`"$2.12"`). */
function wireNumber(wire: Record<string, unknown>, ...keys: string[]): number | undefined {
  const value = readWireField(wire, ...keys);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Reads a currency code that iCarry sends either as a bare string (`"USD"`) or as a currency
 * object (`{ CurrencyCode: "USD", Name: "US Dollar" }`). Anything else yields `undefined`.
 */
function wireCurrencyCode(wire: Record<string, unknown>, ...keys: string[]): string | undefined {
  const value = readWireField(wire, ...keys);
  if (typeof value === 'string') {
    return value;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const code = readWireField(value as Record<string, unknown>, 'CurrencyCode', 'currency_code');
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Maps one wire option, or `undefined` if it lacks the fields `createOrder` requires. */
function toRateOption(wire: Record<string, unknown>): MarketplaceRateOption | undefined {
  const systemShipmentProvider = wireString(
    wire,
    'ShippingRateComputationMethodSystemName',
    'shipping_rate_computation_method_system_name'
  );
  const rawMethodId = readWireField(wire, 'MethodId', 'method_id');
  const methodId =
    typeof rawMethodId === 'string' && rawMethodId.trim() !== ''
      ? rawMethodId
      : typeof rawMethodId === 'number' && Number.isFinite(rawMethodId)
        ? rawMethodId
        : undefined;
  const rate = wireNumber(wire, 'Rate', 'rate');
  // Without all three, the option cannot drive createOrder — drop it rather than hand back a
  // half-built option whose missing `price` would surface as a server-side validation error.
  if (systemShipmentProvider === undefined || methodId === undefined || rate === undefined) {
    return undefined;
  }
  const description = wireString(wire, 'Description', 'description');
  const formattedPrice = wireString(wire, 'Price', 'price');
  const methodName = wireString(wire, 'MethodName', 'method_name');
  const localizedMethodName = wireString(wire, 'LocalizedMethodName', 'localized_method_name');
  const name = wireString(wire, 'Name', 'name');
  const displayOrder = wireNumber(wire, 'DisplayOrder', 'display_order');
  const selected = readWireField(wire, 'Selected', 'selected');
  const codCurrency = wireCurrencyCode(wire, 'CODCurrency', 'cod_currency');
  const workingCurrency = wireCurrencyCode(wire, 'WorkingCurrency', 'working_currency');
  return {
    systemShipmentProvider,
    methodId,
    rate,
    ...(description !== undefined ? { description } : {}),
    ...(formattedPrice !== undefined ? { formattedPrice } : {}),
    ...(methodName !== undefined ? { methodName } : {}),
    ...(localizedMethodName !== undefined ? { localizedMethodName } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(displayOrder !== undefined ? { displayOrder } : {}),
    ...(typeof selected === 'boolean' ? { selected } : {}),
    ...(codCurrency !== undefined ? { codCurrency } : {}),
    ...(workingCurrency !== undefined ? { workingCurrency } : {}),
    raw: wire,
  };
}

/**
 * Structures a {@link MarketplaceRateResult} into {@link MarketplaceRateOption}s.
 *
 * Purely local — it never calls the API, so it is safe to apply to a cached or logged result.
 * It is deliberately strict and total: it **never throws** and returns `[]` for anything it does
 * not recognize (a string body, an empty response, an object that is not a list, or entries
 * missing `ShippingRateComputationMethodSystemName` / `MethodId` / `Rate`). An empty array
 * therefore means "unrecognized shape" as well as "no rates" — if you need to tell those apart,
 * inspect the raw result you passed in.
 *
 * Accepts the observed plain array, and also a `{ Data: [...] }` envelope, since
 * `Warehouse/GetAll` is known to wrap lists that way.
 *
 * ```typescript
 * const result = await icarry.marketplace.estimateRates(input);
 * const options = parseMarketplaceRates(result);
 * if (options.length === 0) {
 *   // shape not recognized — fall back to reading `result` yourself
 * }
 * ```
 */
export function parseMarketplaceRates(result: unknown): MarketplaceRateOption[] {
  const options: MarketplaceRateOption[] = [];
  for (const record of unwrapWireList(result).records) {
    const option = toRateOption(record);
    if (option !== undefined) {
      options.push(option);
    }
  }
  return options;
}

/**
 * Projects a parsed rate option onto the four {@link MarketplaceCreateOrderInput} fields it
 * feeds, so the numeric `rate` — not the formatted `Price` string — becomes the order price.
 *
 * ```typescript
 * const [cheapest] = parseMarketplaceRates(result).sort((a, b) => a.rate - b.rate);
 * if (cheapest) {
 *   await icarry.marketplace.createOrder({ ...orderInput, ...toMarketplaceOrderFields(cheapest) });
 * }
 * ```
 */
export function toMarketplaceOrderFields(
  option: MarketplaceRateOption
): Pick<MarketplaceCreateOrderInput, 'provider' | 'methodId' | 'price' | 'methodDescription'> {
  return {
    provider: option.systemShipmentProvider,
    methodId: option.methodId,
    price: option.rate,
    ...(option.description !== undefined ? { methodDescription: option.description } : {}),
  };
}

/**
 * Serializes {@link MarketplaceRateInput}: merchant rate body + `pickupLocation`. Without `to`,
 * `ToLongitude`/`ToLatitude` are omitted entirely.
 */
export function toWireMarketplaceRate(input: MarketplaceRateInput): Record<string, unknown> {
  return { pickupLocation: input.pickupLocation, ...toWireRateBody(input) };
}

/** Serializes {@link MarketplaceCreateOrderInput}: merchant order body + `pickupLocation`. */
export function toWireMarketplaceCreateOrder(
  input: MarketplaceCreateOrderInput
): Record<string, unknown> {
  return { pickupLocation: input.pickupLocation, ...toWireMerchantCreateOrder(input) };
}

export class MarketplaceResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Estimates marketplace shipping rates. Side-effect-free; not retried by default — pass
   * `{ retry: true }` to enable transient retry.
   */
  async estimateRates(
    input: MarketplaceRateInput,
    options: RequestOptions = {}
  ): Promise<MarketplaceRateResult> {
    requireNonEmptyString(input.pickupLocation, 'pickupLocation');
    validateRateBody(input, { requireTo: false });
    return this.http.request<MarketplaceRateResult>({
      method: 'POST',
      path: ENDPOINTS.marketplaceEstimateRates,
      body: toWireMarketplaceRate(input),
      expect: 'auto',
      retryable: options.retry === true,
      ...toRequestFields(options),
    });
  }

  /** Creates a marketplace order. **Mutating** — never automatically retried. */
  async createOrder(
    input: MarketplaceCreateOrderInput,
    options: RequestOptions = {}
  ): Promise<MarketplaceOrderResult> {
    requireNonEmptyString(input.pickupLocation, 'pickupLocation');
    validateMerchantCreateOrder(input);
    return this.http.request<MarketplaceOrderResult>({
      method: 'POST',
      path: ENDPOINTS.marketplaceCreateOrder,
      body: toWireMarketplaceCreateOrder(input),
      expect: 'auto',
      retryable: false,
      ...toRequestFields(options),
    });
  }
}
