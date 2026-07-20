import { describe, it, expect } from 'vitest';
import {
  OnDemandResource,
  toWireOnDemandRate,
  toWireOnDemandCreateShipment,
} from '../../src/resources/on-demand';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';
import { FAKE_GEO, FAKE_ON_DEMAND_ADDRESS } from '../helpers/fixtures';

const rateInput = {
  pickup: {
    countryId: 125,
    stateProvinceId: 1837,
    geo: { latitude: 0, longitude: 0 },
    postalCode: '',
  },
  drop: { countryId: 125, stateProvinceId: 1837, geo: FAKE_GEO },
  actualWeight: 5,
  packageType: 'documents' as const,
  dimensions: { length: 5, width: 5, height: 5, unit: 'cm' as const },
  isVendor: false,
  cod: { amount: 0, currency: 'USD' },
};

const shipmentInput = {
  pickupAddress: FAKE_ON_DEMAND_ADDRESS,
  dropOffAddress: { ...FAKE_ON_DEMAND_ADDRESS, firstName: 'Recv' },
  actualWeight: 5,
  packageType: 'documents' as const,
  dimensions: { length: 5, width: 5, height: 5 },
  provider: 'Shipping.ICarry.nolimit',
  methodName: 'Motor Express',
  price: 1.3,
  parcel: { quantity: 1, currency: 'USD', packageValue: 0 },
};

describe('on-demand serializers', () => {
  it('rate body uses proper-cased CODCurrency, ids, From/To geo, and dimensions.Unit', () => {
    const body = toWireOnDemandRate(rateInput);
    expect(body.CODCurrency).toBe('USD'); // proper casing (unlike merchant COdCurrency)
    expect(body.PickupCountryId).toBe(125);
    expect(body.dropsStateProvinceId).toBe(1837);
    expect(body.FromLongitude).toBe(0);
    expect(body.ToLatitude).toBe(FAKE_GEO.latitude);
    expect(body.dimensions).toEqual({ Length: 5, Width: 5, Height: 5, Unit: 'cm' });
    expect(body.IsVendor).toBe(false);
  });

  it('shipment body uses MethodName (not MethodId) and id-based addresses', () => {
    const body = toWireOnDemandCreateShipment(shipmentInput);
    expect(body.MethodName).toBe('Motor Express');
    expect(body.MethodId).toBeUndefined();
    expect((body.pickupAddress as Record<string, unknown>).CountryId).toBe(234);
    expect((body.pickupAddress as Record<string, unknown>).StateProvinceId).toBe(1841);
  });
});

describe('OnDemandResource', () => {
  it('estimateRates posts to EstimateRates', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const onDemand = new OnDemandResource(makeHttp(mock));
    await onDemand.estimateRates(rateInput);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/EstimateRates'
    );
    expect(sentBody(mock).CODCurrency).toBe('USD');
  });

  it('createShipment posts to CreateOnDemandShipment', async () => {
    const mock = sequenceFetch(jsonResponse({ shipmentId: 42 }));
    const onDemand = new OnDemandResource(makeHttp(mock));
    await onDemand.createShipment(shipmentInput);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/CreateOnDemandShipment'
    );
    expect(sentBody(mock).MethodName).toBe('Motor Express');
  });
});
