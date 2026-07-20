import { describe, it, expect } from 'vitest';
import {
  MerchantResource,
  toWireMerchantRate,
  toWireMerchantCreateOrder,
} from '../../src/resources/merchant';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';
import { FAKE_GEO, FAKE_PARCEL, FAKE_MERCHANT_ADDRESS } from '../helpers/fixtures';

const rateInput = {
  dropOffLocation: 'Beirut',
  to: FAKE_GEO,
  actualWeight: 1,
  packageType: 'parcel' as const,
  dimensions: { length: 2, width: 2, height: 2 },
  dropAddress: { countryCode: 'LB', city: 'Beirut' },
  parcels: [FAKE_PARCEL],
  cod: { amount: 2, currency: 'USD' },
};

const orderInput = {
  parcels: [FAKE_PARCEL],
  dropOff: FAKE_MERCHANT_ADDRESS,
  actualWeight: 5,
  packageType: 'parcel' as const,
  dimensions: { length: 10, width: 50, height: 30 },
  provider: 'Shipping.ICarry.x',
  methodId: 26,
  price: 3.6,
  parcel: { quantity: 2, packageValue: 120, packageCurrency: 'USD', description: 'test' },
  cod: { amount: 10, currency: 'USD' },
};

describe('merchant serializers', () => {
  it('rate body uses COdCurrency, To coordinates, DropAddress, and ParcelDimensionsList', () => {
    const body = toWireMerchantRate(rateInput);
    expect(body.COdCurrency).toBe('USD');
    expect(body.CODAmount).toBe(2);
    expect(body.DropOffLocation).toBe('Beirut');
    expect(body.ToLongitude).toBe(FAKE_GEO.longitude);
    expect(body.ToLatitude).toBe(FAKE_GEO.latitude);
    expect(body.DropAddress).toEqual({ CountryCode: 'LB', City: 'Beirut' });
    expect(Array.isArray(body.ParcelDimensionsList)).toBe(true);
    expect(body.Dimensions).toEqual({ Length: 2, Width: 2, Height: 2 });
  });

  it('nests an explicit unit inside the Dimensions object (not top-level)', () => {
    const body = toWireMerchantRate({ ...rateInput, unit: 'cm' });
    expect(body.Dimensions).toEqual({ Length: 2, Width: 2, Height: 2, Unit: 'cm' });
    expect(body.Unit).toBeUndefined();
  });

  it('order body uses MethodId (not MethodName) and top-level dimensions', () => {
    const body = toWireMerchantCreateOrder(orderInput);
    expect(body.MethodId).toBe(26);
    expect(body.MethodName).toBeUndefined();
    expect(body.COdCurrency).toBe('USD');
    expect(body.Length).toBe(10);
    expect(body.Width).toBe(50);
    expect(body.Height).toBe(30);
    expect((body.dropOffAddress as Record<string, unknown>).Country).toBe('lebanon');
  });

  it('omits ProcessOrder/ExternalId unless provided', () => {
    expect(toWireMerchantCreateOrder(orderInput).ProcessOrder).toBeUndefined();
    expect(toWireMerchantCreateOrder({ ...orderInput, processOrder: true }).ProcessOrder).toBe(
      true
    );
  });
});

describe('MerchantResource', () => {
  it('estimateRates posts to EstimateRatesByCOD', async () => {
    const mock = sequenceFetch(jsonResponse({ rate: 3 }));
    const merchant = new MerchantResource(makeHttp(mock));
    await merchant.estimateRates(rateInput);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/EstimateRatesByCOD'
    );
    expect(sentBody(mock).COdCurrency).toBe('USD');
  });

  it('estimateRates does NOT retry by default but does with { retry: true }', async () => {
    const mock1 = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const m1 = new MerchantResource(makeHttp(mock1));
    await expect(m1.estimateRates(rateInput)).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock1.calls).toHaveLength(1);

    const mock2 = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const m2 = new MerchantResource(makeHttp(mock2));
    await m2.estimateRates(rateInput, { retry: true });
    expect(mock2.calls).toHaveLength(2);
  });

  it('createOrder is mutating and never retried', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const merchant = new MerchantResource(makeHttp(mock));
    await expect(merchant.createOrder(orderInput)).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it('rejects a non-positive weight', async () => {
    const merchant = new MerchantResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(merchant.estimateRates({ ...rateInput, actualWeight: 0 })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
  });

  it('rejects an out-of-range latitude', async () => {
    const merchant = new MerchantResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(
      merchant.estimateRates({ ...rateInput, to: { latitude: 200, longitude: 0 } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });
});
