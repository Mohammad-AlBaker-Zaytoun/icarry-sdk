import { describe, it, expect } from 'vitest';
import { PaymentsResource } from '../../src/resources/payments';
import { MerchantResource } from '../../src/resources/merchant';
import { OnDemandResource } from '../../src/resources/on-demand';
import { WarehousesResource } from '../../src/resources/warehouses';
import { ICarryValidationError } from '../../src/errors';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';
import {
  FAKE_CARD,
  FAKE_GEO,
  FAKE_PARCEL,
  FAKE_MERCHANT_ADDRESS,
  FAKE_ON_DEMAND_ADDRESS,
} from '../helpers/fixtures';

const http = () => makeHttp(sequenceFetch(jsonResponse({ ok: 1 })));

const merchantOrder = {
  parcels: [FAKE_PARCEL],
  dropOff: FAKE_MERCHANT_ADDRESS,
  actualWeight: 5,
  packageType: 'parcel' as const,
  dimensions: { length: 10, width: 50, height: 30 },
  provider: 'Shipping.ICarry.x',
  methodId: 26,
  price: 3.6,
  parcel: { quantity: 1, packageValue: 120, packageCurrency: 'USD' },
};

const onDemandShipment = {
  pickupAddress: FAKE_ON_DEMAND_ADDRESS,
  dropOffAddress: FAKE_ON_DEMAND_ADDRESS,
  actualWeight: 5,
  packageType: 'documents' as const,
  dimensions: { length: 5, width: 5, height: 5 },
  provider: 'Shipping.ICarry.nolimit',
  methodName: 'Motor Express',
  price: 1.3,
  parcel: { quantity: 1, currency: 'USD', packageValue: 0 },
};

describe('payment input validation', () => {
  const payments = () => new PaymentsResource(http());

  it('rejects a missing cardType', async () => {
    await expect(
      payments().createShipmentOrder(7, { card: { ...FAKE_CARD, cardType: '' } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('rejects a non-numeric expiry year', async () => {
    await expect(
      payments().createShipmentOrder(7, { card: { ...FAKE_CARD, cardExpirationYear: 'soon' } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('rejects a non-localhost http redirect URL but allows https and localhost', async () => {
    await expect(
      payments().createShipmentOrder(7, {
        card: FAKE_CARD,
        redirect: { successUrl: 'http://evil.com/cb' },
      })
    ).rejects.toBeInstanceOf(ICarryValidationError);
    await expect(
      payments().createShipmentOrder(7, {
        card: FAKE_CARD,
        redirect: { successUrl: 'https://ok.com/cb', redirectUrl: 'http://localhost:8080/x' },
      })
    ).resolves.toBeDefined();
  });

  it('rejects an empty paymentMethodSystemName when provided', async () => {
    await expect(
      payments().createShipmentOrder(7, { card: FAKE_CARD, paymentMethodSystemName: '' })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });
});

describe('quantity / value validation', () => {
  it('merchant.createOrder rejects a fractional parcel quantity', async () => {
    const merchant = new MerchantResource(http());
    await expect(
      merchant.createOrder({ ...merchantOrder, parcel: { ...merchantOrder.parcel, quantity: 1.5 } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('merchant.estimateRates rejects a fractional parcel quantity', async () => {
    const merchant = new MerchantResource(http());
    await expect(
      merchant.estimateRates({
        dropOffLocation: 'Beirut',
        to: FAKE_GEO,
        actualWeight: 1,
        packageType: 'parcel',
        dimensions: { length: 1, width: 1, height: 1 },
        dropAddress: { countryCode: 'LB', city: 'Beirut' },
        parcels: [{ ...FAKE_PARCEL, quantity: 2.5 }],
      })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('onDemand.createShipment rejects a negative package value', async () => {
    const onDemand = new OnDemandResource(http());
    await expect(
      onDemand.createShipment({
        ...onDemandShipment,
        parcel: { ...onDemandShipment.parcel, packageValue: -1 },
      })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });
});

describe('numeric id validation', () => {
  it('warehouses.getById rejects alphabetic and decimal ids', async () => {
    const wh = () => new WarehousesResource(http());
    await expect(wh().getById('abc')).rejects.toBeInstanceOf(ICarryValidationError);
    await expect(wh().getById('1.5')).rejects.toBeInstanceOf(ICarryValidationError);
    await expect(wh().getById(1.5)).rejects.toBeInstanceOf(ICarryValidationError);
    await expect(wh().getById(0)).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('warehouses.getById accepts positive integer ids and integer strings', async () => {
    await expect(new WarehousesResource(http()).getById(9)).resolves.toBeDefined();
    await expect(new WarehousesResource(http()).getById('9')).resolves.toBeDefined();
  });
});
