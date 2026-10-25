import { describe, it, expect } from 'vitest';
import {
  ShipmentsResource,
  isCancellationRejected,
  isCreatedTrackingResult,
  isShipmentDeleteSuccess,
  isShipmentNotFoundError,
} from '../../src/resources/shipments';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentUrl } from '../helpers/http';
import {
  sequenceFetch,
  jsonResponse,
  pdfResponse,
  stringError,
  textResponse,
} from '../helpers/mockFetch';

describe('ShipmentsResource', () => {
  it('track encodes the tracking number in the query', async () => {
    const mock = sequenceFetch(jsonResponse({ status: 'in_transit' }));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await shipments.track('ABC/123 45');
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/orderTracking?trackingNumber=ABC%2F123+45'
    );
  });

  it('cancel is a mutating GET that is never retried', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.cancel('TRACK1')).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.init.method).toBe('GET');
    expect(sentUrl(mock)).toContain('/CancelOrder?trackingNumber=TRACK1');
  });

  it('getPackagingSlip returns binary for a PDF response', async () => {
    const mock = sequenceFetch(pdfResponse([0x25, 0x50, 0x44, 0x46]));
    const shipments = new ShipmentsResource(makeHttp(mock));
    const slip = await shipments.getPackagingSlip(7);
    expect(slip.kind).toBe('binary');
    if (slip.kind === 'binary') {
      expect(Array.from(slip.data)).toEqual([0x25, 0x50, 0x44, 0x46]);
      expect(slip.contentType).toContain('application/pdf');
    }
    expect(sentUrl(mock)).toContain('/PdfPackagingSlip/7');
  });

  it('getPackagingSlip returns json when the server returns a JSON envelope', async () => {
    const mock = sequenceFetch(jsonResponse({ url: 'https://x/slip.pdf' }));
    const shipments = new ShipmentsResource(makeHttp(mock));
    const slip = await shipments.getPackagingSlip(7);
    expect(slip.kind).toBe('json');
    if (slip.kind === 'json') {
      expect(slip.data).toEqual({ url: 'https://x/slip.pdf' });
    }
  });

  it('validates a non-empty tracking number', async () => {
    const shipments = new ShipmentsResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(shipments.track('')).rejects.toBeInstanceOf(ICarryValidationError);
  });
});

describe('ShipmentsResource.delete', () => {
  it('POSTs to DeleteShipment/{id} with no body', async () => {
    const mock = sequenceFetch(textResponse('shipment Delete success'));
    const shipments = new ShipmentsResource(makeHttp(mock));
    const result = await shipments.delete(4242);
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/SmartwareShipment/DeleteShipment/4242'
    );
    expect(mock.calls[0]?.init.method).toBe('POST');
    expect(mock.calls[0]?.init.body ?? undefined).toBeUndefined();
    expect(result).toBe('shipment Delete success');
    expect(isShipmentDeleteSuccess(result)).toBe(true);
  });

  it('accepts a numeric-string id (ids are often stored as strings)', async () => {
    const mock = sequenceFetch(jsonResponse('shipment Delete success'));
    const shipments = new ShipmentsResource(makeHttp(mock));
    expect(isShipmentDeleteSuccess(await shipments.delete(' 4242 '))).toBe(true);
    expect(sentUrl(mock)).toContain('/DeleteShipment/4242');
  });

  it('is mutating and never retried', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), textResponse('shipment Delete success'));
    const shipments = new ShipmentsResource(makeHttp(mock));
    await expect(shipments.delete(4242)).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it.each([0, -1, 1.5, 'abc', '', '12/34', Number.NaN])(
    'rejects an invalid id (%s) before any request',
    async (id) => {
      const mock = sequenceFetch(textResponse('shipment Delete success'));
      const shipments = new ShipmentsResource(makeHttp(mock));
      await expect(shipments.delete(id as number)).rejects.toBeInstanceOf(ICarryValidationError);
      expect(mock.calls).toHaveLength(0);
    }
  );
});

describe('shipment reply helpers', () => {
  it('isShipmentDeleteSuccess recognises only the observed success text', () => {
    for (const ok of ['shipment Delete success', 'Shipment delete success', '  delete success ']) {
      expect(isShipmentDeleteSuccess(ok)).toBe(true);
    }
    for (const no of [
      'shipment Delete failed',
      'not delete success',
      'delete success, but pending',
      'deleted',
      '',
      true,
      1,
      null,
      undefined,
      { message: 'shipment Delete success' },
      ['shipment Delete success'],
    ]) {
      expect(isShipmentDeleteSuccess(no)).toBe(false);
    }
  });

  it('isCreatedTrackingResult reads the bare "Created" tracking reply', async () => {
    const mock = sequenceFetch(textResponse('Created'), jsonResponse('Created'));
    const shipments = new ShipmentsResource(makeHttp(mock));
    expect(isCreatedTrackingResult(await shipments.track('IC-FAKE-0001'))).toBe(true);
    expect(isCreatedTrackingResult(await shipments.track('IC-FAKE-0001'))).toBe(true);
    for (const no of ['Created later', 'Delivered', '', { status: 'Created' }, null, undefined]) {
      expect(isCreatedTrackingResult(no)).toBe(false);
    }
  });

  it('isShipmentNotFoundError matches the live "not exists" reply and 404s only', async () => {
    const mock = sequenceFetch(
      stringError(400, 'shipment IC-FAKE-0001 not exists'),
      stringError(404, 'Not Found'),
      stringError(400, 'Invalid tracking request')
    );
    const shipments = new ShipmentsResource(makeHttp(mock));
    const errors: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      errors.push(await shipments.track('IC-FAKE-0001').catch((e: unknown) => e));
    }
    expect(errors.map(isShipmentNotFoundError)).toEqual([true, true, false]);
    // Only a real API reply counts — never a local error carrying similar text.
    expect(isShipmentNotFoundError(new Error('shipment X not exists'))).toBe(false);
    expect(isShipmentNotFoundError('shipment X not exists')).toBe(false);
    expect(isShipmentNotFoundError(undefined)).toBe(false);
  });

  it('isCancellationRejected recognises the carrier refusing a cancel', async () => {
    const mock = sequenceFetch(stringError(400, 'Cannot cancelled this order.'));
    const shipments = new ShipmentsResource(makeHttp(mock));
    const error = await shipments.cancel('IC-FAKE-0001').catch((e: unknown) => e);
    expect(isCancellationRejected(error)).toBe(true);
    expect(isCancellationRejected('Cannot cancelled this order.')).toBe(true);
    expect(isCancellationRejected('This shipment cannot be cancelled')).toBe(true);
    for (const no of [
      'Order cancelled',
      'cancelled',
      new Error('Cannot cancelled this order.'),
      { message: 'Cannot cancelled this order.' },
      null,
    ]) {
      expect(isCancellationRejected(no)).toBe(false);
    }
  });
});
