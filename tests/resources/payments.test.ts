import { describe, it, expect } from 'vitest';
import { PaymentsResource } from '../../src/resources/payments';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';
import { FAKE_CARD } from '../helpers/fixtures';

describe('PaymentsResource.createShipmentOrder', () => {
  it('sends card data as query parameters (preserving iCarry contract) and never retries', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: true }));
    const payments = new PaymentsResource(makeHttp(mock));
    await payments.createShipmentOrder(7, { card: FAKE_CARD });
    const url = sentUrl(mock);
    expect(url).toContain('/CreateShipmentOrder/7?');
    expect(url).toContain('cardNumber=1111222233334444');
    expect(url).toContain('cardCVV=000');
    expect(url).toContain('paymentMethodSystemName=Payments.MontyPay');
    expect(mock.calls[0]?.init.method).toBe('POST');
  });

  it('never retries the payment call', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({}));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.createShipmentOrder(7, { card: FAKE_CARD })).rejects.toBeInstanceOf(
      ICarryApiError
    );
    expect(mock.calls).toHaveLength(1);
  });

  it('does not leak the card number in a thrown API error', async () => {
    const mock = sequenceFetch(stringError(400, 'Payment declined'));
    const payments = new PaymentsResource(makeHttp(mock));
    try {
      await payments.createShipmentOrder(7, { card: FAKE_CARD });
      throw new Error('should have thrown');
    } catch (e) {
      const serialized = JSON.stringify({
        message: (e as Error).message,
        details: (e as ICarryApiError).details,
      });
      expect(serialized).not.toContain('1111222233334444');
      expect(serialized).not.toContain(FAKE_CARD.cardCvv);
      // path is present but carries no query string
      expect((e as ICarryApiError).details?.path).toBe(
        '/api-frontend/SmartwareShipment/CreateShipmentOrder/7'
      );
    }
  });

  it('redacts card params in the onRequest hook url', async () => {
    const urls: string[] = [];
    const mock = sequenceFetch(jsonResponse({}));
    const payments = new PaymentsResource(
      makeHttp(mock, { hooks: { onRequest: (info) => void urls.push(info.url) } })
    );
    await payments.createShipmentOrder(7, { card: FAKE_CARD });
    expect(urls[0]).toContain('cardNumber=[REDACTED]');
    expect(urls[0]).not.toContain('1111222233334444');
  });

  it('rejects an invalid expiry month', async () => {
    const payments = new PaymentsResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(
      payments.createShipmentOrder(7, { card: { ...FAKE_CARD, cardExpirationMonth: 13 } })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('rejects a non-positive shipment id', async () => {
    const payments = new PaymentsResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(payments.createShipmentOrder(0, { card: FAKE_CARD })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
  });
});

describe('PaymentsResource — other operations', () => {
  it('confirmPayment posts the body to the shipment path', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const payments = new PaymentsResource(makeHttp(mock));
    await payments.confirmPayment(9, { IsSettled: true, CODAmount: 10 });
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/ConfirmPayment/9'
    );
  });

  it('montyPay success/cancel send orderId and shipmentId queries', async () => {
    const mockS = sequenceFetch(jsonResponse('ok'));
    const paymentsS = new PaymentsResource(makeHttp(mockS));
    await paymentsS.processMontyPaySuccess({ orderId: 3, shipmentId: 7 });
    expect(sentUrl(mockS)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/montyPaySuccessReturnUrl?orderId=3&shipmentId=7'
    );

    const mockC = sequenceFetch(jsonResponse('ok'));
    const paymentsC = new PaymentsResource(makeHttp(mockC));
    await paymentsC.processMontyPayCancellation({ orderId: 3, shipmentId: 7 });
    expect(sentUrl(mockC)).toContain('/montyPayCancelReturnUrl?orderId=3&shipmentId=7');
  });
});
