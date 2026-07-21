import { describe, it, expect } from 'vitest';
import { PaymentsResource } from '../../src/resources/payments';
import { ShipmentsResource } from '../../src/resources/shipments';
import { makeHttp } from '../helpers/http';
import {
  sequenceFetch,
  jsonResponse,
  textResponse,
  emptyResponse,
  pdfResponse,
  fakeResponse,
} from '../helpers/mockFetch';
import { FAKE_CARD } from '../helpers/fixtures';

describe('ambiguous successful responses (via resource methods)', () => {
  it('payment createShipmentOrder handles a plain-text success without throwing', async () => {
    const mock = sequenceFetch(textResponse('ok', 200));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.createShipmentOrder(7, { card: FAKE_CARD })).resolves.toBe('ok');
  });

  it('payment confirmPayment handles a JSON-string success', async () => {
    const mock = sequenceFetch(jsonResponse('confirmed'));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.confirmPayment(7, { IsSettled: true })).resolves.toBe('confirmed');
  });

  it('payment result can be an empty 200 body', async () => {
    const mock = sequenceFetch(emptyResponse(200));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.confirmPayment(7, { IsSettled: true })).resolves.toBeUndefined();
  });

  it('montyPay returns handle a bare-string body', async () => {
    const mock = sequenceFetch(textResponse('success', 200));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.processMontyPaySuccess({ orderId: 1, shipmentId: 2 })).resolves.toBe(
      'success'
    );
  });

  it('shipments.cancel handles a plain-text result', async () => {
    const mock = sequenceFetch(textResponse('cancelled', 200));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.cancel('TRACK1')).resolves.toBe('cancelled');
  });

  it('shipments.track handles a plain-text result', async () => {
    const mock = sequenceFetch(textResponse('in transit', 200));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.track('TRACK1')).resolves.toBe('in transit');
  });

  it('handles a missing content-type carrying JSON', async () => {
    const mock = sequenceFetch(() => fakeResponse('{"status":"ok"}', { contentType: null }));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.track('TRACK1')).resolves.toEqual({ status: 'ok' });
  });

  it('handles a missing content-type carrying plain text (no parse error)', async () => {
    const mock = sequenceFetch(() => fakeResponse('accepted', { contentType: null }));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.track('TRACK1')).resolves.toBe('accepted');
  });

  it('packaging slip stays binary/JSON aware', async () => {
    const binMock = sequenceFetch(pdfResponse([0x25, 0x50, 0x44, 0x46]));
    const jsonMock = sequenceFetch(jsonResponse({ url: 'https://x/y.pdf' }));
    expect((await new ShipmentsResource(makeHttp(binMock)).getPackagingSlip(1)).kind).toBe(
      'binary'
    );
    expect((await new ShipmentsResource(makeHttp(jsonMock)).getPackagingSlip(1)).kind).toBe('json');
  });
});
