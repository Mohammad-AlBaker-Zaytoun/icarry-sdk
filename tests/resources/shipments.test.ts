import { describe, it, expect } from 'vitest';
import { ShipmentsResource } from '../../src/resources/shipments';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, pdfResponse, stringError } from '../helpers/mockFetch';

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
