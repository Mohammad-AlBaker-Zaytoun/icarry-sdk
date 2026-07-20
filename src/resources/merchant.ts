/**
 * Merchant shipping resource (COD rate estimation + order creation).
 *
 * This model uses a country **code** + free-text drop-off location and the wire's
 * misspelled `COdCurrency`. Order creation uses `MethodId` and serializes dimensions to
 * **top-level** `Length`/`Width`/`Height`. Rate/order response shapes are unverified and
 * returned as {@link MerchantRateResult}/{@link MerchantOrderResult} (open records).
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import type {
  Dimensions,
  ExtensibleResponse,
  GeoPoint,
  NumericInput,
  PackageType,
  ParcelDimensions,
  RequestOptions,
  DimensionUnit,
} from '../types';
import {
  omitUndefined,
  toWireDimensions,
  toWireGeo,
  toWireParcel,
  toRequestFields,
  requireNonEmptyString,
  requirePositiveMeasure,
  requireNonNegativeMoney,
  validateDimensions,
  validateGeoPoint,
  validateParcels,
} from './_shared';

/** Cash-on-delivery amount + currency (currency serialized to the wire's `COdCurrency`). */
export interface CodAmount {
  amount: NumericInput;
  currency: string;
}

/** Recipient address for merchant order creation (free-text country). */
export interface MerchantAddress {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  /** Country chosen from the iCarry country list. */
  country: string;
  /** City/state chosen from the iCarry list. */
  city: string;
  address1: string;
  address2?: string;
  zipPostalCode?: string;
}

/** Input for {@link MerchantResource.estimateRates}. */
export interface MerchantRateInput {
  dropOffLocation: string;
  /** Recipient coordinates → wire `ToLongitude`/`ToLatitude`. */
  to: GeoPoint;
  actualWeight: NumericInput;
  packageType: PackageType;
  dimensions: Dimensions;
  dropAddress: { countryCode: string; city: string };
  parcels: ParcelDimensions[];
  cod?: CodAmount;
  /**
   * Dimension unit ("cm"/"inch"). Serialized into the `Dimensions` object (as in the
   * on-demand model); the docs list it flat but nest the dimensions themselves, so its
   * exact placement is unverified.
   */
  unit?: DimensionUnit;
  /** Documented as `ZipPostCode`; exact placement unverified. */
  zipPostCode?: string;
}

/** Input for {@link MerchantResource.createOrder}. */
export interface MerchantCreateOrderInput {
  parcels: ParcelDimensions[];
  dropOff: MerchantAddress;
  actualWeight: NumericInput;
  packageType: PackageType;
  /** Serialized to **top-level** `Length`/`Width`/`Height`. */
  dimensions: Dimensions;
  provider: string;
  /** Serialized to `MethodId` (merchant/marketplace flavor). */
  methodId: number | string;
  price: NumericInput;
  parcel: {
    quantity: number;
    packageValue: NumericInput;
    packageCurrency: string;
    description?: string;
  };
  cod?: CodAmount;
  notes?: string;
  methodDescription?: string;
  /** Documented but not shown in the request body; sent only when provided. */
  processOrder?: boolean;
  /** Documented but not shown in the request body; sent only when provided. */
  externalId?: string;
}

/**
 * Rate-estimation result. The response schema is **unverified** (the Postman example is an
 * echo of the request); fields are returned as received.
 */
export type MerchantRateResult = ExtensibleResponse;

/**
 * Order-creation result. **Unverified** schema — returned as received. Read defensively.
 */
export type MerchantOrderResult = ExtensibleResponse;

/** Serializes recipient address to the merchant order wire shape (free-text `Country`). */
export function toWireMerchantAddress(a: MerchantAddress): Record<string, unknown> {
  return omitUndefined({
    FirstName: a.firstName,
    LastName: a.lastName,
    Email: a.email,
    PhoneNumber: a.phoneNumber,
    Country: a.country,
    City: a.city,
    Address1: a.address1,
    Address2: a.address2,
    ZipPostalCode: a.zipPostalCode,
  });
}

/** Serializes {@link MerchantRateInput} to the exact wire body. */
export function toWireMerchantRate(input: MerchantRateInput): Record<string, unknown> {
  return omitUndefined({
    CODAmount: input.cod?.amount,
    COdCurrency: input.cod?.currency, // deliberate wire misspelling
    DropOffLocation: input.dropOffLocation,
    ...toWireGeo('To', input.to),
    ActualWeight: input.actualWeight,
    Dimensions: omitUndefined({ ...toWireDimensions(input.dimensions), Unit: input.unit }),
    PackageType: input.packageType,
    DropAddress: { CountryCode: input.dropAddress.countryCode, City: input.dropAddress.city },
    ParcelDimensionsList: input.parcels.map(toWireParcel),
    ZipPostCode: input.zipPostCode,
  });
}

/** Serializes {@link MerchantCreateOrderInput} to the exact wire body (uses `MethodId`). */
export function toWireMerchantCreateOrder(
  input: MerchantCreateOrderInput
): Record<string, unknown> {
  return omitUndefined({
    ParcelDimensionsList: input.parcels.map(toWireParcel),
    dropOffAddress: toWireMerchantAddress(input.dropOff),
    CODAmount: input.cod?.amount,
    COdCurrency: input.cod?.currency,
    ActualWeight: input.actualWeight,
    PackageType: input.packageType,
    Length: input.dimensions.length,
    Width: input.dimensions.width,
    Height: input.dimensions.height,
    Notes: input.notes,
    SystemShipmentProvider: input.provider,
    MethodId: input.methodId,
    MethodDescription: input.methodDescription,
    Price: input.price,
    ParcelQuantity: input.parcel.quantity,
    ParcelPackageValue: input.parcel.packageValue,
    ParcelPackageCurrency: input.parcel.packageCurrency,
    ParcelDescription: input.parcel.description,
    ProcessOrder: input.processOrder,
    ExternalId: input.externalId,
  });
}

export function validateMerchantRate(input: MerchantRateInput): void {
  requireNonEmptyString(input.dropOffLocation, 'dropOffLocation');
  validateGeoPoint(input.to, 'to');
  requirePositiveMeasure(input.actualWeight, 'actualWeight');
  requireNonEmptyString(input.packageType, 'packageType');
  validateDimensions(input.dimensions, 'dimensions');
  requireNonEmptyString(input.dropAddress?.countryCode, 'dropAddress.countryCode');
  requireNonEmptyString(input.dropAddress?.city, 'dropAddress.city');
  validateParcels(input.parcels, 'parcels');
  if (input.cod) {
    requireNonNegativeMoney(input.cod.amount, 'cod.amount');
    requireNonEmptyString(input.cod.currency, 'cod.currency');
  }
}

export function validateMerchantAddress(a: MerchantAddress, field = 'dropOff'): void {
  requireNonEmptyString(a?.firstName, `${field}.firstName`);
  requireNonEmptyString(a?.lastName, `${field}.lastName`);
  requireNonEmptyString(a?.email, `${field}.email`);
  requireNonEmptyString(a?.phoneNumber, `${field}.phoneNumber`);
  requireNonEmptyString(a?.country, `${field}.country`);
  requireNonEmptyString(a?.city, `${field}.city`);
  requireNonEmptyString(a?.address1, `${field}.address1`);
}

export function validateMerchantCreateOrder(input: MerchantCreateOrderInput): void {
  validateParcels(input.parcels, 'parcels');
  validateMerchantAddress(input.dropOff);
  requirePositiveMeasure(input.actualWeight, 'actualWeight');
  requireNonEmptyString(input.packageType, 'packageType');
  validateDimensions(input.dimensions, 'dimensions');
  requireNonEmptyString(input.provider, 'provider');
  requireNonEmptyString(String(input.methodId ?? ''), 'methodId');
  requirePositiveMeasure(input.price, 'price');
  if (input.cod) {
    requireNonNegativeMoney(input.cod.amount, 'cod.amount');
    requireNonEmptyString(input.cod.currency, 'cod.currency');
  }
}

export class MerchantResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Estimates COD shipping rates. Side-effect-free; not retried by default — pass
   * `{ retry: true }` to enable transient retry.
   */
  async estimateRates(
    input: MerchantRateInput,
    options: RequestOptions = {}
  ): Promise<MerchantRateResult> {
    validateMerchantRate(input);
    return this.http.request<MerchantRateResult>({
      method: 'POST',
      path: ENDPOINTS.merchantEstimateRates,
      body: toWireMerchantRate(input),
      retryable: options.retry === true,
      ...toRequestFields(options),
    });
  }

  /** Creates a merchant order. **Mutating** — never automatically retried. */
  async createOrder(
    input: MerchantCreateOrderInput,
    options: RequestOptions = {}
  ): Promise<MerchantOrderResult> {
    validateMerchantCreateOrder(input);
    return this.http.request<MerchantOrderResult>({
      method: 'POST',
      path: ENDPOINTS.merchantCreateOrder,
      body: toWireMerchantCreateOrder(input),
      retryable: false,
      ...toRequestFields(options),
    });
  }
}
