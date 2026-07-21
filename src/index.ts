/**
 * icarry-sdk — an unofficial, type-safe, secure client for the iCarry shipping & logistics API.
 *
 * @packageDocumentation
 */

// ---- Client ----------------------------------------------------------------
export { ICarryClient } from './client';
export type { LowLevelRequest } from './client';
export type { ICarryClientOptions } from './config';

// ---- Errors (values — needed for `instanceof`) -----------------------------
export {
  ICarryError,
  ICarryConfigurationError,
  ICarryValidationError,
  ICarryAuthenticationError,
  ICarryApiError,
  ICarryNetworkError,
  ICarryTimeoutError,
  ICarryAbortError,
  ICarryResponseParseError,
  ERROR_CODES,
} from './errors';
export type { ICarryErrorCode, ICarryErrorOptions, ICarryApiErrorDetails } from './errors';

// ---- Constants -------------------------------------------------------------
export { SDK_VERSION, PACKAGE_TYPES } from './constants';

// ---- Shared types ----------------------------------------------------------
export type {
  NumericInput,
  DimensionUnit,
  PackageType,
  GeoPoint,
  Dimensions,
  DimensionsWithUnit,
  ParcelDimensions,
  ExtensibleResponse,
  ICarryEntity,
  AmbiguousApiResult,
  RetryOptions,
  RetryPolicy,
  RequestOptions,
  SafeRequestInfo,
  SafeResponseInfo,
  RetryEvent,
  ICarryHooks,
  SafeHookError,
  HookPhase,
} from './types';
export type { FetchLike } from './transport/http-client';

// ---- Resource types (classes exported as types; instances live on the client) ----
export type { AuthResource, AuthenticateRequest, AuthTokenResponse } from './resources/auth';
export type {
  WarehousesResource,
  Warehouse,
  MarketplaceWarehouseAddress,
  CreateMarketplaceWarehouseInput,
  ListWarehousesOptions,
} from './resources/warehouses';
export type {
  CountriesResource,
  Country,
  StateItem,
  StateProvince,
  ListStatesOptions,
} from './resources/countries';
export type {
  MerchantResource,
  CodAmount,
  MerchantAddress,
  MerchantRateInput,
  MerchantCreateOrderInput,
  MerchantRateResult,
  MerchantOrderResult,
} from './resources/merchant';
export type {
  MarketplaceResource,
  MarketplaceRateInput,
  MarketplaceCreateOrderInput,
  MarketplaceRateResult,
  MarketplaceOrderResult,
} from './resources/marketplace';
export type {
  OnDemandResource,
  OnDemandAddress,
  OnDemandRateEndpoint,
  OnDemandRateInput,
  OnDemandCreateShipmentInput,
  OnDemandRateResult,
  OnDemandShipmentResult,
} from './resources/on-demand';
export type {
  PaymentsResource,
  PaymentCardInput,
  PaymentRedirectUrls,
  CreateShipmentOrderInput,
  ConfirmPaymentInput,
  MontyPayReturnInput,
  PaymentResult,
} from './resources/payments';
export type {
  ShipmentsResource,
  TrackingResult,
  CancelResult,
  PackagingSlip,
} from './resources/shipments';
