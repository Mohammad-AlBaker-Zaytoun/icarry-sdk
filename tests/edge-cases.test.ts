import { describe, it, expect } from 'vitest';
import { ICarryClient } from '../src/client';
import { parseResponse } from '../src/transport/response-parser';
import { redact, redactUrl, REDACTED } from '../src/transport/redaction';
import { toWireOnDemandRate } from '../src/resources/on-demand';
import { ShipmentsResource } from '../src/resources/shipments';
import { CountriesResource } from '../src/resources/countries';
import { WarehousesResource } from '../src/resources/warehouses';
import { PaymentsResource } from '../src/resources/payments';
import { ICarryValidationError } from '../src/errors';
import { makeHttp } from './helpers/http';
import { sequenceFetch, jsonResponse } from './helpers/mockFetch';
import { FAKE_GEO, FAKE_CARD } from './helpers/fixtures';

describe('client.request full options', () => {
  it('threads query/body/auth/retryable/expect/headers through the transport', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: 1 }));
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      token: 't',
      fetch: mock.fetch as never,
    });
    const result = await client.request<{ ok: number }>({
      method: 'POST',
      path: '/X',
      query: { a: '1' },
      body: { b: 2 },
      auth: true,
      retryable: false,
      expect: 'json',
      headers: { 'X-Trace': 'z' },
      timeoutMs: 5000,
    });
    expect(result).toEqual({ ok: 1 });
    expect(mock.calls[0]?.url).toBe('https://test.icarry.com/api-frontend/X?a=1');
    expect((mock.calls[0]?.init.headers as Record<string, string>)['X-Trace']).toBe('z');
  });
});

describe('parseResponse extra modes', () => {
  it("expect 'empty' hands back an unexpected body as text", async () => {
    const r = await parseResponse(new Response('surprise', { status: 200 }), 'empty');
    expect(r.kind).toBe('text');
  });

  it('auto mode falls back to text for text/plain', async () => {
    const res = new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } });
    const r = await parseResponse(res, 'auto');
    expect(r.kind).toBe('text');
  });
});

describe('redaction edges', () => {
  it('maskEmail returns REDACTED for a value with no @', () => {
    expect(redact({ email: 'not-an-email' }, { redactEmail: true }).email).toBe(REDACTED);
  });

  it('redactUrl preserves a hash fragment', () => {
    expect(redactUrl('/pay?cardNumber=1111222233334444#done')).toBe(
      `/pay?cardNumber=${REDACTED}#done`
    );
  });
});

describe('on-demand serialization without COD', () => {
  it('sends CODCurrency null and defaults postal codes', () => {
    const body = toWireOnDemandRate({
      pickup: { countryId: 1, stateProvinceId: 2, geo: { latitude: 0, longitude: 0 } },
      drop: { countryId: 1, stateProvinceId: 2, geo: FAKE_GEO },
      actualWeight: 1,
      packageType: 'documents',
      dimensions: { length: 1, width: 1, height: 1 },
      isVendor: false,
    });
    expect(body.CODCurrency).toBeNull();
    expect(body.CODAmount).toBe(0);
    expect(body.PickupPostalCode).toBe('');
  });
});

describe('mappers with minimal fields', () => {
  it('countries.getById maps a minimal country', async () => {
    const mock = sequenceFetch(jsonResponse({ name: 'X', id: 1 }));
    const result = await new CountriesResource(makeHttp(mock)).getById(1);
    expect(result).toEqual({ name: 'X', id: 1 });
  });

  it('warehouses.getById maps a minimal warehouse', async () => {
    const mock = sequenceFetch(jsonResponse({ name: 'W', is_active: false, id: 2 }));
    const result = await new WarehousesResource(makeHttp(mock)).getById(2);
    expect(result).toEqual({ name: 'W', isActive: false, id: 2 });
  });
});

describe('shipments packaging slip filename + text envelope', () => {
  it('extracts a filename from content-disposition', async () => {
    const res = new Response(new Uint8Array([1, 2]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="slip-7.pdf"',
      },
    });
    const mock = sequenceFetch(res);
    const slip = await new ShipmentsResource(makeHttp(mock)).getPackagingSlip(7);
    expect(slip.kind).toBe('binary');
    if (slip.kind === 'binary') expect(slip.filename).toBe('slip-7.pdf');
  });

  it('maps a text response to a json envelope', async () => {
    const res = new Response('https://x/slip.pdf', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const mock = sequenceFetch(res);
    const slip = await new ShipmentsResource(makeHttp(mock)).getPackagingSlip(7);
    expect(slip).toEqual({ kind: 'json', data: 'https://x/slip.pdf' });
  });
});

describe('payments validation edges', () => {
  it('rejects a missing card', async () => {
    const payments = new PaymentsResource(makeHttp(sequenceFetch(jsonResponse({}))));
    // @ts-expect-error missing card intentionally
    await expect(payments.createShipmentOrder(1, {})).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('rejects a non-object confirm body', async () => {
    const payments = new PaymentsResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(
      payments.confirmPayment(1, null as unknown as Record<string, unknown>)
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });

  it('accepts a valid card (smoke of the happy path)', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: true }));
    const payments = new PaymentsResource(makeHttp(mock));
    await expect(payments.createShipmentOrder(1, { card: FAKE_CARD })).resolves.toBeDefined();
  });
});
