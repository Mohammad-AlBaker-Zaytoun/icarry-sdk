/**
 * On-demand shipping resource.
 *
 * A **different** wire model from merchant/marketplace: rate estimation uses country/state
 * **ids** (not codes), `From*`/`To*` coordinates, a nested `dimensions` object with `Unit`,
 * and the wire's proper-cased `CODCurrency`. Shipment creation uses `MethodName` (not
 * `MethodId`) and id-based addresses. Response schemas are unverified.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import type {
  DimensionsWithUnit,
  ExtensibleResponse,
  GeoPoint,
  NumericInput,
  PackageType,
  RequestOptions,
  Dimensions,
} from '../types';
import {
  omitUndefined,
  toWireDimensionsWithUnit,
  toWireGeo,
  toRequestFields,
  requireNonEmptyString,
  requirePositiveId,
  requirePositiveMeasure,
  requireNonNegativeMoney,
  validateDimensions,
  validateGeoPoint,
} from './_shared';

/** An address keyed by country/state ids (on-demand model). */
export interface OnDemandAddress {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  countryId: number;
  stateProvinceId: number;
  address1: string;
  address2?: string;
  zipPostalCode?: string;
}

/** A pickup/drop endpoint for rate estimation. */
export interface OnDemandRateEndpoint {
  countryId: number;
  stateProvinceId: number;
  geo: GeoPoint;
  postalCode?: string;
}

/** Input for {@link OnDemandResource.estimateRates}. */
export interface OnDemandRateInput {
  pickup: OnDemandRateEndpoint;
  drop: OnDemandRateEndpoint;
  actualWeight: NumericInput;
  packageType: PackageType;
  dimensions: DimensionsWithUnit;
  isVendor: boolean;
  /** Cash-on-delivery (serialized to the wire's proper-cased `CODCurrency`). */
  cod?: { amount: NumericInput; currency: string };
}

/** Input for {@link OnDemandResource.createShipment}. */
export interface OnDemandCreateShipmentInput {
  pickupAddress: OnDemandAddress;
  dropOffAddress: OnDemandAddress;
  actualWeight: NumericInput;
  packageType: PackageType;
  dimensions: Dimensions;
  provider: string;
  /** Serialized to `MethodName` (on-demand flavor — not `MethodId`). */
  methodName: string;
  price: NumericInput;
  parcel: {
    quantity: number;
    currency: string;
    packageValue: NumericInput;
    description?: string;
  };
  notes?: string;
  methodDescription?: string;
  createAccount?: boolean;
  notifyByEmail?: boolean;
}

/** Unverified rate result — returned as received. */
export type OnDemandRateResult = ExtensibleResponse;
/** Unverified shipment-creation result — returned as received. Expected to carry a shipment id. */
export type OnDemandShipmentResult = ExtensibleResponse;

function toWireOnDemandAddress(a: OnDemandAddress): Record<string, unknown> {
  return omitUndefined({
    FirstName: a.firstName,
    LastName: a.lastName,
    Email: a.email,
    PhoneNumber: a.phoneNumber,
    CountryId: a.countryId,
    StateProvinceId: a.stateProvinceId,
    Address1: a.address1,
    Address2: a.address2,
    ZipPostalCode: a.zipPostalCode,
  });
}

/** Serializes {@link OnDemandRateInput} to the exact wire body (ids + `CODCurrency`). */
export function toWireOnDemandRate(input: OnDemandRateInput): Record<string, unknown> {
  return omitUndefined({
    PickupCountryId: input.pickup.countryId,
    PickupStateProvinceId: input.pickup.stateProvinceId,
    PickupPostalCode: input.pickup.postalCode ?? '',
    ...toWireGeo('From', input.pickup.geo),
    dropCountryId: input.drop.countryId,
    dropsStateProvinceId: input.drop.stateProvinceId,
    dropPostalCode: input.drop.postalCode ?? '',
    ...toWireGeo('To', input.drop.geo),
    ActualWeight: input.actualWeight,
    PackageType: input.packageType,
    dimensions: toWireDimensionsWithUnit(input.dimensions),
    IsVendor: input.isVendor,
    CODCurrency: input.cod?.currency ?? null,
    CODAmount: input.cod?.amount ?? 0,
  });
}

/** Serializes {@link OnDemandCreateShipmentInput} to the exact wire body (uses `MethodName`). */
export function toWireOnDemandCreateShipment(
  input: OnDemandCreateShipmentInput
): Record<string, unknown> {
  return omitUndefined({
    createAccount: input.createAccount ?? false,
    notifyByEmail: input.notifyByEmail ?? false,
    pickupAddress: toWireOnDemandAddress(input.pickupAddress),
    dropOffAddress: toWireOnDemandAddress(input.dropOffAddress),
    ActualWeight: input.actualWeight,
    PackageType: input.packageType,
    Length: input.dimensions.length,
    Width: input.dimensions.width,
    Height: input.dimensions.height,
    Notes: input.notes,
    ParcelQuantity: input.parcel.quantity,
    ParcelCurrency: input.parcel.currency,
    ParcelPackageValue: input.parcel.packageValue,
    ParcelDescription: input.parcel.description,
    SystemShipmentProvider: input.provider,
    MethodName: input.methodName,
    MethodDescription: input.methodDescription,
    Price: input.price,
  });
}

function validateRateEndpoint(endpoint: OnDemandRateEndpoint, field: string): void {
  requirePositiveId(endpoint?.countryId, `${field}.countryId`);
  requirePositiveId(endpoint?.stateProvinceId, `${field}.stateProvinceId`);
  validateGeoPoint(endpoint?.geo, `${field}.geo`);
}

function validateOnDemandAddress(a: OnDemandAddress, field: string): void {
  requireNonEmptyString(a?.firstName, `${field}.firstName`);
  requireNonEmptyString(a?.lastName, `${field}.lastName`);
  requireNonEmptyString(a?.email, `${field}.email`);
  requireNonEmptyString(a?.phoneNumber, `${field}.phoneNumber`);
  requirePositiveId(a?.countryId, `${field}.countryId`);
  requirePositiveId(a?.stateProvinceId, `${field}.stateProvinceId`);
  requireNonEmptyString(a?.address1, `${field}.address1`);
}

export class OnDemandResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Estimates on-demand rates. Side-effect-free; not retried by default — pass
   * `{ retry: true }` to enable transient retry.
   */
  async estimateRates(
    input: OnDemandRateInput,
    options: RequestOptions = {}
  ): Promise<OnDemandRateResult> {
    validateRateEndpoint(input.pickup, 'pickup');
    validateRateEndpoint(input.drop, 'drop');
    requirePositiveMeasure(input.actualWeight, 'actualWeight');
    requireNonEmptyString(input.packageType, 'packageType');
    validateDimensions(input.dimensions, 'dimensions');
    if (input.cod) {
      requireNonNegativeMoney(input.cod.amount, 'cod.amount');
      requireNonEmptyString(input.cod.currency, 'cod.currency');
    }
    return this.http.request<OnDemandRateResult>({
      method: 'POST',
      path: ENDPOINTS.onDemandEstimateRates,
      body: toWireOnDemandRate(input),
      retryable: options.retry === true,
      ...toRequestFields(options),
    });
  }

  /** Creates an on-demand shipment. **Mutating** — never automatically retried. */
  async createShipment(
    input: OnDemandCreateShipmentInput,
    options: RequestOptions = {}
  ): Promise<OnDemandShipmentResult> {
    validateOnDemandAddress(input.pickupAddress, 'pickupAddress');
    validateOnDemandAddress(input.dropOffAddress, 'dropOffAddress');
    requirePositiveMeasure(input.actualWeight, 'actualWeight');
    requireNonEmptyString(input.packageType, 'packageType');
    validateDimensions(input.dimensions, 'dimensions');
    requireNonEmptyString(input.provider, 'provider');
    requireNonEmptyString(input.methodName, 'methodName');
    requirePositiveMeasure(input.price, 'price');
    return this.http.request<OnDemandShipmentResult>({
      method: 'POST',
      path: ENDPOINTS.onDemandCreateShipment,
      body: toWireOnDemandCreateShipment(input),
      retryable: false,
      ...toRequestFields(options),
    });
  }
}
