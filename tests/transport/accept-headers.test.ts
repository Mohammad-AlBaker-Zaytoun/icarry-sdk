import { describe, it, expect } from 'vitest';
import { makeHttp } from '../helpers/http';
import { CountriesResource } from '../../src/resources/countries';
import { ShipmentsResource } from '../../src/resources/shipments';
import { PaymentsResource } from '../../src/resources/payments';
import { sequenceFetch, jsonResponse, pdfResponse, type MockFetch } from '../helpers/mockFetch';

function acceptOf(mock: MockFetch, i = 0): string | undefined {
  const headers = mock.calls[i]?.init.headers as Record<string, string>;
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === 'accept');
  return entry?.[1];
}

function acceptCount(mock: MockFetch, i = 0): number {
  const headers = mock.calls[i]?.init.headers as Record<string, string>;
  return Object.keys(headers).filter((k) => k.toLowerCase() === 'accept').length;
}

describe('Accept header per expect mode', () => {
  it('strict JSON (countries) → application/json', async () => {
    const mock = sequenceFetch(jsonResponse([]));
    await new CountriesResource(makeHttp(mock)).list();
    expect(acceptOf(mock)).toBe('application/json');
  });

  it('auto (tracking) → JSON-preferred, NOT pdf-preferred', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await new ShipmentsResource(makeHttp(mock)).track('T1');
    expect(acceptOf(mock)).toBe('application/json, text/plain;q=0.9, */*;q=0.1');
    expect(acceptOf(mock)).not.toContain('application/pdf');
  });

  it('auto (payment confirm) → JSON-preferred, not pdf', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await new PaymentsResource(makeHttp(mock)).confirmPayment(1, { IsSettled: true });
    expect(acceptOf(mock)).toBe('application/json, text/plain;q=0.9, */*;q=0.1');
  });

  it('packaging slip → binary (PDF) preferred', async () => {
    const mock = sequenceFetch(pdfResponse([0x25, 0x50, 0x44, 0x46]));
    await new ShipmentsResource(makeHttp(mock)).getPackagingSlip(7);
    const accept = acceptOf(mock) ?? '';
    expect(accept.startsWith('application/pdf')).toBe(true);
    expect(accept).toContain('application/octet-stream');
  });

  it('explicit text mode → text-preferred', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({ method: 'GET', path: '/x', expect: 'text' });
    expect(acceptOf(mock)).toBe('text/plain, application/json;q=0.9, */*;q=0.1');
  });

  it('binary mode → pdf then octet-stream', async () => {
    const mock = sequenceFetch(pdfResponse([1]));
    await makeHttp(mock).requestRaw({ method: 'GET', path: '/x', expect: 'binary' });
    expect(acceptOf(mock)).toBe('application/pdf, application/octet-stream;q=0.9, */*;q=0.1');
  });

  it('caller-provided Accept overrides the default, and stays single', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({
      method: 'GET',
      path: '/x',
      expect: 'auto',
      headers: { accept: 'application/xml' },
    });
    expect(acceptOf(mock)).toBe('application/xml');
    expect(acceptCount(mock)).toBe(1);
  });
});
