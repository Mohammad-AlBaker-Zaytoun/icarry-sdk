/**
 * Marketplace shipping resource. The wire model is identical to the merchant model plus a
 * `pickupLocation` (the warehouse/pickup name). Uses `MethodId` and `COdCurrency` like the
 * merchant flow. (Marketplace *warehouse* creation lives on `client.warehouses`.)
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import type { ExtensibleResponse, RequestOptions } from '../types';
import { toRequestFields, requireNonEmptyString } from './_shared';
import {
  type MerchantRateInput,
  type MerchantCreateOrderInput,
  toWireMerchantRate,
  toWireMerchantCreateOrder,
  validateMerchantRate,
  validateMerchantCreateOrder,
} from './merchant';

/** Input for {@link MarketplaceResource.estimateRates} (merchant rate model + pickup). */
export interface MarketplaceRateInput extends MerchantRateInput {
  /** Warehouse / pickup-location name, as listed under "My locations". */
  pickupLocation: string;
}

/** Input for {@link MarketplaceResource.createOrder} (merchant order model + pickup). */
export interface MarketplaceCreateOrderInput extends MerchantCreateOrderInput {
  pickupLocation: string;
}

/** Unverified rate-estimation result — returned as received. */
export type MarketplaceRateResult = ExtensibleResponse;
/** Unverified order-creation result — returned as received. */
export type MarketplaceOrderResult = ExtensibleResponse;

/** Serializes {@link MarketplaceRateInput}: merchant rate body + `pickupLocation`. */
export function toWireMarketplaceRate(input: MarketplaceRateInput): Record<string, unknown> {
  return { pickupLocation: input.pickupLocation, ...toWireMerchantRate(input) };
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
    validateMerchantRate(input);
    return this.http.request<MarketplaceRateResult>({
      method: 'POST',
      path: ENDPOINTS.marketplaceEstimateRates,
      body: toWireMarketplaceRate(input),
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
      retryable: false,
      ...toRequestFields(options),
    });
  }
}
