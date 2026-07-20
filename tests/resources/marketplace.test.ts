import { describe, it, expect } from 'vitest';
import {
  MarketplaceResource,
  toWireMarketplaceRate,
  toWireMarketplaceCreateOrder,
} from '../../src/resources/marketplace';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';
import { FAKE_GEO, FAKE_PARCEL, FAKE_MERCHANT_ADDRESS } from '../helpers/fixtures';

const rateInput = {
  pickupLocation: 'MyWarehouse',
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
  pickupLocation: 'MyWarehouse',
  parcels: [FAKE_PARCEL],
  dropOff: FAKE_MERCHANT_ADDRESS,
  actualWeight: 5,
  packageType: 'parcel' as const,
  dimensions: { length: 10, width: 50, height: 30 },
  provider: 'Shipping.ICarry.x',
  methodId: '26',
  price: 3.6,
  parcel: { quantity: 2, packageValue: 120, packageCurrency: 'USD' },
  cod: { amount: 10, currency: 'USD' },
};

describe('marketplace serializers', () => {
  it('rate body adds pickupLocation to the merchant model', () => {
    const body = toWireMarketplaceRate(rateInput);
    expect(body.pickupLocation).toBe('MyWarehouse');
    expect(body.COdCurrency).toBe('USD');
  });

  it('order body adds pickupLocation and uses MethodId', () => {
    const body = toWireMarketplaceCreateOrder(orderInput);
    expect(body.pickupLocation).toBe('MyWarehouse');
    expect(body.MethodId).toBe('26');
    expect(body.MethodName).toBeUndefined();
  });
});

describe('MarketplaceResource', () => {
  it('estimateRates posts to the marketplace endpoint', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    await marketplace.estimateRates(rateInput);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/EstimateRatesForMarketplace'
    );
    expect(sentBody(mock).pickupLocation).toBe('MyWarehouse');
  });

  it('createOrder posts to the marketplace order endpoint', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    await marketplace.createOrder(orderInput);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/CreateOrderForMarketPlace'
    );
  });
});
