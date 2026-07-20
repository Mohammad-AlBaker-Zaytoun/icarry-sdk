/**
 * Shared serializer building blocks and lightweight input validators used across resources.
 *
 * Wire builders here are the pieces that are genuinely identical across endpoints (parcels,
 * dimensions, geo pairs). Address serialization is deliberately *not* shared because the
 * merchant/marketplace and on-demand models differ (free-text country vs country/state ids).
 *
 * @packageDocumentation
 */

import { ICarryValidationError } from '../errors';
import type {
  Dimensions,
  DimensionsWithUnit,
  GeoPoint,
  NumericInput,
  ParcelDimensions,
  RequestOptions,
} from '../types';

/** Transport-facing subset of per-call options (signal/timeout/headers). */
export interface RequestFields {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** Extracts the transport spec fields from public {@link RequestOptions}, omitting unset ones. */
export function toRequestFields(options: RequestOptions): RequestFields {
  const out: RequestFields = {};
  if (options.signal !== undefined) {
    out.signal = options.signal;
  }
  if (options.timeoutMs !== undefined) {
    out.timeoutMs = options.timeoutMs;
  }
  if (options.headers !== undefined) {
    out.headers = options.headers;
  }
  return out;
}

/** Removes keys whose value is `undefined`, so the SDK never emits an unset field. */
export function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Serializes one parcel line to the wire `ParcelDimensionsList` element shape. */
export function toWireParcel(parcel: ParcelDimensions): Record<string, unknown> {
  return {
    Quantity: parcel.quantity,
    Weight: parcel.weight,
    Length: parcel.length,
    Width: parcel.width,
    Height: parcel.height,
  };
}

/** Serializes dimensions to a nested `{ Length, Width, Height }` object. */
export function toWireDimensions(dimensions: Dimensions): Record<string, unknown> {
  return { Length: dimensions.length, Width: dimensions.width, Height: dimensions.height };
}

/** Serializes dimensions with an optional `Unit` (on-demand model). */
export function toWireDimensionsWithUnit(dimensions: DimensionsWithUnit): Record<string, unknown> {
  return omitUndefined({
    Length: dimensions.length,
    Width: dimensions.width,
    Height: dimensions.height,
    Unit: dimensions.unit,
  });
}

/** Serializes a geo point to `{ <prefix>Longitude, <prefix>Latitude }`. */
export function toWireGeo(prefix: 'From' | 'To', geo: GeoPoint): Record<string, number> {
  return prefix === 'From'
    ? { FromLongitude: geo.longitude, FromLatitude: geo.latitude }
    : { ToLongitude: geo.longitude, ToLatitude: geo.latitude };
}

// ---------------------------------------------------------------------------
// Lightweight validators — catch obvious caller mistakes, not server rules.
// ---------------------------------------------------------------------------

function toFinite(value: NumericInput): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function requireNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ICarryValidationError(`${field} must be a non-empty string.`, field);
  }
}

export function requirePositiveId(value: unknown, field: string): void {
  if (typeof value === 'string') {
    if (value.trim() === '') {
      throw new ICarryValidationError(`${field} must be provided.`, field);
    }
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ICarryValidationError(`${field} must be a positive id.`, field);
  }
}

export function requirePositiveMeasure(value: NumericInput, field: string): void {
  const n = toFinite(value);
  if (n === null || n <= 0) {
    throw new ICarryValidationError(`${field} must be a positive number.`, field);
  }
}

export function requireNonNegativeMoney(value: NumericInput, field: string): void {
  const n = toFinite(value);
  if (n === null || n < 0) {
    throw new ICarryValidationError(`${field} must be a non-negative amount.`, field);
  }
}

export function validateGeoPoint(geo: GeoPoint, field: string): void {
  if (!geo || typeof geo !== 'object') {
    throw new ICarryValidationError(`${field} is required.`, field);
  }
  if (!Number.isFinite(geo.latitude) || geo.latitude < -90 || geo.latitude > 90) {
    throw new ICarryValidationError(
      `${field}.latitude must be between -90 and 90.`,
      `${field}.latitude`
    );
  }
  if (!Number.isFinite(geo.longitude) || geo.longitude < -180 || geo.longitude > 180) {
    throw new ICarryValidationError(
      `${field}.longitude must be between -180 and 180.`,
      `${field}.longitude`
    );
  }
}

export function validateDimensions(dimensions: Dimensions, field: string): void {
  if (!dimensions || typeof dimensions !== 'object') {
    throw new ICarryValidationError(`${field} is required.`, field);
  }
  requirePositiveMeasure(dimensions.length, `${field}.length`);
  requirePositiveMeasure(dimensions.width, `${field}.width`);
  requirePositiveMeasure(dimensions.height, `${field}.height`);
}

export function validateParcels(parcels: ParcelDimensions[], field: string): void {
  if (!Array.isArray(parcels) || parcels.length === 0) {
    throw new ICarryValidationError(`${field} must contain at least one parcel.`, field);
  }
  parcels.forEach((parcel, index) => {
    if (!Number.isFinite(parcel.quantity) || parcel.quantity <= 0) {
      throw new ICarryValidationError(
        `${field}[${index}].quantity must be a positive number.`,
        `${field}[${index}].quantity`
      );
    }
    requirePositiveMeasure(parcel.weight, `${field}[${index}].weight`);
    requirePositiveMeasure(parcel.length, `${field}[${index}].length`);
    requirePositiveMeasure(parcel.width, `${field}[${index}].width`);
    requirePositiveMeasure(parcel.height, `${field}[${index}].height`);
  });
}
