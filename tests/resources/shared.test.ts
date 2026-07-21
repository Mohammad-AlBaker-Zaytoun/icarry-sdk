import { describe, it, expect } from 'vitest';
import {
  omitUndefined,
  toWireParcel,
  toWireDimensions,
  toWireDimensionsWithUnit,
  toWireGeo,
  toRequestFields,
  requireNonEmptyString,
  requirePositiveId,
  requirePositiveInteger,
  requireAbsoluteHttpsUrl,
  requirePositiveMeasure,
  requireNonNegativeMoney,
  validateGeoPoint,
  validateDimensions,
  validateParcels,
} from '../../src/resources/_shared';
import { ICarryValidationError } from '../../src/errors';

describe('_shared wire builders', () => {
  it('omitUndefined drops undefined keys only', () => {
    expect(omitUndefined({ a: 1, b: undefined, c: null, d: 0 })).toEqual({ a: 1, c: null, d: 0 });
  });

  it('toWireParcel / toWireDimensions map fields', () => {
    expect(toWireParcel({ quantity: 1, weight: 2, length: 3, width: 4, height: 5 })).toEqual({
      Quantity: 1,
      Weight: 2,
      Length: 3,
      Width: 4,
      Height: 5,
    });
    expect(toWireDimensions({ length: 1, width: 2, height: 3 })).toEqual({
      Length: 1,
      Width: 2,
      Height: 3,
    });
  });

  it('toWireDimensionsWithUnit omits an absent unit', () => {
    expect(toWireDimensionsWithUnit({ length: 1, width: 2, height: 3 })).toEqual({
      Length: 1,
      Width: 2,
      Height: 3,
    });
    expect(toWireDimensionsWithUnit({ length: 1, width: 2, height: 3, unit: 'cm' }).Unit).toBe(
      'cm'
    );
  });

  it('toWireGeo maps From/To prefixes', () => {
    expect(toWireGeo('From', { latitude: 1, longitude: 2 })).toEqual({
      FromLongitude: 2,
      FromLatitude: 1,
    });
    expect(toWireGeo('To', { latitude: 1, longitude: 2 })).toEqual({
      ToLongitude: 2,
      ToLatitude: 1,
    });
  });

  it('toRequestFields keeps only set fields', () => {
    expect(toRequestFields({})).toEqual({});
    const signal = new AbortController().signal;
    expect(toRequestFields({ signal, timeoutMs: 5, headers: { a: 'b' } })).toEqual({
      signal,
      timeoutMs: 5,
      headers: { a: 'b' },
    });
  });
});

describe('_shared validators', () => {
  it('requireNonEmptyString', () => {
    expect(() => requireNonEmptyString('ok', 'f')).not.toThrow();
    expect(() => requireNonEmptyString('', 'f')).toThrow(ICarryValidationError);
    expect(() => requireNonEmptyString(undefined, 'f')).toThrow(ICarryValidationError);
  });

  it('requirePositiveId accepts positive integers and integer strings only', () => {
    expect(() => requirePositiveId(5, 'id')).not.toThrow();
    expect(() => requirePositiveId('1837', 'id')).not.toThrow();
    // Rejections: alphabetic, decimal, zero, negative, empty, nullish, Infinity/NaN.
    expect(() => requirePositiveId('abc', 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId('1.2', 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(1.2, 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(0, 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId('0', 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(-1, 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId('-1', 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId('', 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(Number.NaN, 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(Number.POSITIVE_INFINITY, 'id')).toThrow(ICarryValidationError);
    expect(() => requirePositiveId(null as unknown as number, 'id')).toThrow(ICarryValidationError);
  });

  it('requirePositiveInteger rejects non-integers', () => {
    expect(() => requirePositiveInteger(3, 'q')).not.toThrow();
    expect(() => requirePositiveInteger(1.5, 'q')).toThrow(ICarryValidationError);
    expect(() => requirePositiveInteger(0, 'q')).toThrow(ICarryValidationError);
    expect(() => requirePositiveInteger(-2, 'q')).toThrow(ICarryValidationError);
    expect(() => requirePositiveInteger('3' as unknown, 'q')).toThrow(ICarryValidationError);
  });

  it('requireAbsoluteHttpsUrl accepts https and localhost http only', () => {
    expect(() => requireAbsoluteHttpsUrl('https://x.com/ok', 'u')).not.toThrow();
    expect(() => requireAbsoluteHttpsUrl('http://localhost:8080/cb', 'u')).not.toThrow();
    expect(() => requireAbsoluteHttpsUrl('http://evil.com/cb', 'u')).toThrow(ICarryValidationError);
    expect(() => requireAbsoluteHttpsUrl('not-a-url', 'u')).toThrow(ICarryValidationError);
  });

  it('requirePositiveMeasure accepts numbers and numeric strings', () => {
    expect(() => requirePositiveMeasure('1.5', 'm')).not.toThrow();
    expect(() => requirePositiveMeasure(2, 'm')).not.toThrow();
    expect(() => requirePositiveMeasure(0, 'm')).toThrow(ICarryValidationError);
    expect(() => requirePositiveMeasure('abc', 'm')).toThrow(ICarryValidationError);
  });

  it('requireNonNegativeMoney allows zero but not negatives', () => {
    expect(() => requireNonNegativeMoney(0, 'a')).not.toThrow();
    expect(() => requireNonNegativeMoney('10.00', 'a')).not.toThrow();
    expect(() => requireNonNegativeMoney(-1, 'a')).toThrow(ICarryValidationError);
    expect(() => requireNonNegativeMoney('nope', 'a')).toThrow(ICarryValidationError);
  });

  it('validateGeoPoint enforces lat/lng ranges', () => {
    expect(() => validateGeoPoint({ latitude: 33, longitude: 35 }, 'g')).not.toThrow();
    expect(() => validateGeoPoint({ latitude: 91, longitude: 0 }, 'g')).toThrow(
      ICarryValidationError
    );
    expect(() => validateGeoPoint({ latitude: 0, longitude: 181 }, 'g')).toThrow(
      ICarryValidationError
    );
    expect(() => validateGeoPoint(undefined as never, 'g')).toThrow(ICarryValidationError);
  });

  it('validateDimensions requires positive dims', () => {
    expect(() => validateDimensions({ length: 1, width: 1, height: 1 }, 'd')).not.toThrow();
    expect(() => validateDimensions({ length: 0, width: 1, height: 1 }, 'd')).toThrow(
      ICarryValidationError
    );
    expect(() => validateDimensions(undefined as never, 'd')).toThrow(ICarryValidationError);
  });

  it('validateParcels requires at least one valid parcel', () => {
    expect(() =>
      validateParcels([{ quantity: 1, weight: 1, length: 1, width: 1, height: 1 }], 'p')
    ).not.toThrow();
    expect(() => validateParcels([], 'p')).toThrow(ICarryValidationError);
    expect(() =>
      validateParcels([{ quantity: 0, weight: 1, length: 1, width: 1, height: 1 }], 'p')
    ).toThrow(ICarryValidationError);
  });
});
