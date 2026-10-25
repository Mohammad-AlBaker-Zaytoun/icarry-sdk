import { describe, it, expect } from 'vitest';
import {
  MarketplaceResource,
  isUnsupportedCityError,
  parseMarketplaceRates,
  toMarketplaceOrderFields,
  toWireMarketplaceRate,
  toWireMarketplaceCreateOrder,
} from '../../src/resources/marketplace';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
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

/**
 * Shape observed live on 2026-07-30 from `POST /SmartwareShipment/EstimateRatesForMarketplace` —
 * a plain JSON array of PascalCase options. Note `Rate` is numeric while `Price` is a
 * currency-formatted display string. Values are synthetic; only the keys and their kinds matter.
 */
const liveRateOption = {
  CODCurrency: 'USD',
  CarrierAdminVehicleTypeId: 0,
  CarrierModel: null,
  CarrierTransportationTypeId: 0,
  CustomProperties: {},
  DeliveryDateFormat: null,
  Description: 'Delivery in 2-3 days',
  DisplayOrder: 1,
  Finance: null,
  LocalizedMethodName: 'Standard',
  MethodBodyInfo: null,
  MethodId: 26,
  MethodName: 'Standard',
  Name: 'iCarry Standard',
  Price: '$2.12',
  Rate: 2.121,
  Selected: false,
  ShippingRateComputationMethodSystemName: 'Shipping.ICarry.Standard',
  WorkingCurrency: 'USD',
  friendlyPluginName: null,
};

describe('parseMarketplaceRates', () => {
  it('maps the live rate option and keeps the numeric Rate separate from the formatted Price', () => {
    const options = parseMarketplaceRates([liveRateOption]);
    expect(options).toHaveLength(1);
    const option = options[0]!;
    expect(option.systemShipmentProvider).toBe('Shipping.ICarry.Standard');
    expect(option.methodId).toBe(26);
    expect(option.rate).toBe(2.121);
    expect(option.formattedPrice).toBe('$2.12');
    expect(option.description).toBe('Delivery in 2-3 days');
    expect(option.methodName).toBe('Standard');
    expect(option.localizedMethodName).toBe('Standard');
    expect(option.name).toBe('iCarry Standard');
    expect(option.displayOrder).toBe(1);
    expect(option.selected).toBe(false);
    expect(option.codCurrency).toBe('USD');
    expect(option.workingCurrency).toBe('USD');
  });

  it('preserves unmodeled fields verbatim on raw', () => {
    const [option] = parseMarketplaceRates([liveRateOption]);
    expect(option?.raw).toBe(liveRateOption);
    expect(option?.raw.Finance).toBeNull();
    expect(option?.raw.CarrierTransportationTypeId).toBe(0);
  });

  it('never coerces an object or a formatted string into a modeled field', () => {
    const [option] = parseMarketplaceRates([
      { ...liveRateOption, Description: { text: 'x' }, MethodName: 12, DisplayOrder: 'first' },
    ]);
    expect(option?.description).toBeUndefined();
    expect(option?.methodName).toBeUndefined();
    expect(option?.displayOrder).toBeUndefined();
    // A tenant sending Rate as a numeric string is still usable; "$2.12" would not be.
    expect(parseMarketplaceRates([{ ...liveRateOption, Rate: '2.121' }])[0]?.rate).toBe(2.121);
    expect(parseMarketplaceRates([{ ...liveRateOption, Rate: '$2.12' }])).toEqual([]);
  });

  it('drops options missing any field createOrder requires', () => {
    const { MethodId, ...noMethodId } = liveRateOption;
    const { Rate, ...noRate } = liveRateOption;
    const { ShippingRateComputationMethodSystemName, ...noProvider } = liveRateOption;
    expect(parseMarketplaceRates([noMethodId, noRate, noProvider])).toEqual([]);
    expect(parseMarketplaceRates([noRate, liveRateOption])).toHaveLength(1);
  });

  it('returns [] for every unrecognized result shape and never throws', () => {
    expect(parseMarketplaceRates(undefined)).toEqual([]);
    expect(parseMarketplaceRates(null)).toEqual([]);
    expect(parseMarketplaceRates('')).toEqual([]);
    expect(parseMarketplaceRates('Order not found')).toEqual([]);
    expect(parseMarketplaceRates(42)).toEqual([]);
    expect(parseMarketplaceRates([])).toEqual([]);
    expect(parseMarketplaceRates([null, 'x'])).toEqual([]);
    expect(parseMarketplaceRates({ error: 'nope' })).toEqual([]);
  });

  it('also accepts a Data envelope', () => {
    expect(parseMarketplaceRates({ Data: [liveRateOption], recordsTotal: 1 })).toHaveLength(1);
  });

  it('toMarketplaceOrderFields feeds createOrder the numeric rate', () => {
    const [option] = parseMarketplaceRates([liveRateOption]);
    expect(toMarketplaceOrderFields(option!)).toEqual({
      provider: 'Shipping.ICarry.Standard',
      methodId: 26,
      price: 2.121,
      methodDescription: 'Delivery in 2-3 days',
    });
  });

  it('toMarketplaceOrderFields omits methodDescription when the option has none', () => {
    const { Description, ...noDescription } = liveRateOption;
    const [option] = parseMarketplaceRates([noDescription]);
    expect(toMarketplaceOrderFields(option!)).not.toHaveProperty('methodDescription');
  });

  it('an estimateRates result flows into createOrder without a formatted price', async () => {
    const mock = sequenceFetch(jsonResponse([liveRateOption]), jsonResponse({}));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    const result = await marketplace.estimateRates(rateInput);
    const [option] = parseMarketplaceRates(result);
    await marketplace.createOrder({ ...orderInput, ...toMarketplaceOrderFields(option!) });
    const body = sentBody(mock, 1);
    expect(body.Price).toBe(2.121);
    expect(body.SystemShipmentProvider).toBe('Shipping.ICarry.Standard');
    expect(body.MethodId).toBe(26);
    expect(body.MethodDescription).toBe('Delivery in 2-3 days');
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

describe('marketplace city-name quoting (no coordinates)', () => {
  const { to, ...cityOnly } = rateInput;

  it('omits ToLatitude/ToLongitude entirely when `to` is not given', () => {
    const body = toWireMarketplaceRate({ ...cityOnly, unit: 'cm' });
    expect(body).not.toHaveProperty('ToLatitude');
    expect(body).not.toHaveProperty('ToLongitude');
    // The exact body priced live on lb.icarry.com (2026-10-15), values synthetic.
    expect(body).toEqual({
      pickupLocation: 'MyWarehouse',
      CODAmount: 2,
      COdCurrency: 'USD',
      DropOffLocation: 'Beirut',
      ActualWeight: 1,
      Dimensions: { Length: 2, Width: 2, Height: 2, Unit: 'cm' },
      PackageType: 'parcel',
      DropAddress: { CountryCode: 'LB', City: 'Beirut' },
      ParcelDimensionsList: [
        {
          Quantity: FAKE_PARCEL.quantity,
          Weight: FAKE_PARCEL.weight,
          Length: FAKE_PARCEL.length,
          Width: FAKE_PARCEL.width,
          Height: FAKE_PARCEL.height,
        },
      ],
    });
  });

  it('still sends coordinates exactly as before when `to` is given', () => {
    const body = toWireMarketplaceRate(rateInput);
    expect(body.ToLatitude).toBe(FAKE_GEO.latitude);
    expect(body.ToLongitude).toBe(FAKE_GEO.longitude);
  });

  it('estimateRates accepts a city-only input and sends no coordinates', async () => {
    const mock = sequenceFetch(jsonResponse([liveRateOption]));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    const result = await marketplace.estimateRates(cityOnly);
    expect(parseMarketplaceRates(result)).toHaveLength(1);
    expect(sentBody(mock)).not.toHaveProperty('ToLatitude');
    expect(sentBody(mock)).not.toHaveProperty('ToLongitude');
  });

  it('still validates `to` when it is supplied', async () => {
    const mock = sequenceFetch(jsonResponse([]));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    await expect(
      marketplace.estimateRates({ ...rateInput, to: { latitude: 200, longitude: 0 } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
    expect(mock.calls).toHaveLength(0);
  });

  it('isUnsupportedCityError recognises the carrier rejecting an unknown city name', async () => {
    const mock = sequenceFetch(stringError(404, 'Unsupported City'), stringError(400, 'Bad'));
    const marketplace = new MarketplaceResource(makeHttp(mock));
    const unsupported = await marketplace.estimateRates(cityOnly).catch((e: unknown) => e);
    const other = await marketplace.estimateRates(cityOnly).catch((e: unknown) => e);
    expect(unsupported).toBeInstanceOf(ICarryApiError);
    expect(isUnsupportedCityError(unsupported)).toBe(true);
    expect(isUnsupportedCityError(other)).toBe(false);
    expect(isUnsupportedCityError(new Error('Unsupported City'))).toBe(false);
    expect(isUnsupportedCityError('Unsupported City')).toBe(false);
  });
});

describe('parseMarketplaceRates currency objects', () => {
  it('reads WorkingCurrency sent as a currency object (the live lb.icarry.com form)', () => {
    const [option] = parseMarketplaceRates([
      { ...liveRateOption, WorkingCurrency: { CurrencyCode: 'USD', Name: 'US Dollar' } },
    ]);
    expect(option?.workingCurrency).toBe('USD');
    expect(option?.raw.WorkingCurrency).toEqual({ CurrencyCode: 'USD', Name: 'US Dollar' });
  });

  it('reads CODCurrency in either form too', () => {
    const [option] = parseMarketplaceRates([
      { ...liveRateOption, CODCurrency: { CurrencyCode: 'USD' } },
    ]);
    expect(option?.codCurrency).toBe('USD');
  });

  it('never invents a code from anything else', () => {
    for (const value of [null, 12, ['USD'], {}, { CurrencyCode: 840 }, { Name: 'US Dollar' }]) {
      const [option] = parseMarketplaceRates([{ ...liveRateOption, WorkingCurrency: value }]);
      expect(option?.workingCurrency).toBeUndefined();
      expect(option?.rate).toBe(2.121);
    }
  });
});
