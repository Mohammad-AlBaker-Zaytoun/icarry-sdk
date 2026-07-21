/**
 * Compile-time constants and defaults for the iCarry SDK.
 *
 * @packageDocumentation
 */

import type { RetryPolicy } from './types';

/** SDK version, mirrored into the default `User-Agent`. Keep in sync with package.json. */
export const SDK_VERSION = '0.1.6';

/**
 * The API path segment iCarry mounts every route under. The client appends this to the
 * configured `baseUrl` unless the `baseUrl` already ends with it, so callers may pass
 * either `https://test.icarry.com` or `https://test.icarry.com/api-frontend`.
 */
export const API_PREFIX = '/api-frontend';

/** Default `User-Agent` sent with every request (overridable via client options). */
export const USER_AGENT = `icarry-sdk/${SDK_VERSION}`;

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Conservative default transient-retry policy. Applies only to explicitly retry-eligible
 * (idempotent, side-effect-free) calls; mutating and payment calls are never retried.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Documented package-type values, offered as autocomplete hints. The wire type is an open
 * string union ({@link PackageType}), so undocumented values are still accepted.
 */
export const PACKAGE_TYPES = ['parcel', 'documents', 'Product'] as const;

/**
 * Relative endpoint paths (appended after {@link API_PREFIX}). Centralised so the ugly
 * upstream `SmartwareShipment` naming is confined to one place and never leaks into the
 * public API surface.
 */
export const ENDPOINTS = {
  authGetToken: '/Authenticate/GetTokenForCustomerApi',

  warehouseGetById: '/Warehouse/GetById',
  warehouseGetAll: '/Warehouse/GetAll',
  warehouseCreateForMarketplace: '/Warehouse/createWarehouseForMarketPlace',

  countryGetAll: '/Country/GetAllCountry',
  countryGetById: '/Country/GetById',
  countryGetStatesByCountryId: '/Country/GetStatesByCountryId',
  countryGetStateProvincesById: '/Country/GetStateProvincesById',

  merchantEstimateRates: '/SmartwareShipment/EstimateRatesByCOD',
  merchantCreateOrder: '/SmartwareShipment/CreateOrder',

  marketplaceEstimateRates: '/SmartwareShipment/EstimateRatesForMarketplace',
  marketplaceCreateOrder: '/SmartwareShipment/CreateOrderForMarketPlace',

  onDemandEstimateRates: '/SmartwareShipment/EstimateRates',
  onDemandCreateShipment: '/SmartwareShipment/CreateOnDemandShipment',

  createShipmentOrder: '/SmartwareShipment/CreateShipmentOrder',
  confirmPayment: '/SmartwareShipment/ConfirmPayment',
  montyPaySuccessReturnUrl: '/SmartwareShipment/montyPaySuccessReturnUrl',
  montyPayCancelReturnUrl: '/SmartwareShipment/montyPayCancelReturnUrl',

  orderTracking: '/SmartwareShipment/orderTracking',
  cancelOrder: '/SmartwareShipment/CancelOrder',
  pdfPackagingSlip: '/SmartwareShipment/PdfPackagingSlip',
} as const;
