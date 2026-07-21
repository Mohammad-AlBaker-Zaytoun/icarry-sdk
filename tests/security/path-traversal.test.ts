import { describe, it, expect } from 'vitest';
import { ICarryClient } from '../../src/client';
import { WarehousesResource } from '../../src/resources/warehouses';
import { ICarryValidationError } from '../../src/errors';
import { validateRelativeApiPath } from '../../src/transport/url';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';

const TRAVERSAL_PATHS = [
  '../admin',
  '/../admin',
  '/a/../../admin',
  '/%2e%2e/admin',
  '/%2E%2E/admin',
  '/.%2e/admin',
  '/%2e./admin',
  '/./admin',
  '/..\\admin',
  '/%5cadmin',
  '/%5Cadmin',
  '/a/%2e%2e/b',
  '/%252e%252e/admin', // double-encoded
];

describe('validateRelativeApiPath (unit)', () => {
  it('rejects every traversal / backslash form', () => {
    for (const p of TRAVERSAL_PATHS) {
      expect(validateRelativeApiPath(p).ok, `expected reject: ${p}`).toBe(false);
    }
  });

  it('accepts normal relative paths and SDK-encoded path params', () => {
    expect(validateRelativeApiPath('/Country/GetById/5').ok).toBe(true);
    expect(validateRelativeApiPath('Warehouse/GetAll').ok).toBe(true);
    // encodePathParam('a/b 1') === 'a%2Fb%201' — a legitimate encoded param must still pass.
    expect(validateRelativeApiPath('/Warehouse/GetById/a%2Fb%201').ok).toBe(true);
  });
});

describe('low-level request path traversal (client, pre-fetch)', () => {
  it('rejects traversal paths before any fetch runs and sends no token', async () => {
    for (const p of TRAVERSAL_PATHS) {
      const mock = sequenceFetch(jsonResponse({}));
      const client = new ICarryClient({
        baseUrl: 'https://test.icarry.com',
        token: 'secret-token',
        fetch: mock.fetch as never,
      });
      await expect(client.request({ method: 'GET', path: p })).rejects.toBeInstanceOf(
        ICarryValidationError
      );
      expect(mock.calls, `fetch must not run for ${p}`).toHaveLength(0);
    }
  });

  it('allows a valid low-level path', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: 1 }));
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      token: 't',
      fetch: mock.fetch as never,
    });
    await client.request({ method: 'GET', path: '/Some/Endpoint' });
    expect(mock.calls[0]?.url).toBe('https://test.icarry.com/api-frontend/Some/Endpoint');
  });
});

describe('transport-layer API-prefix guard (post-URL normalization)', () => {
  it('rejects a path that normalizes outside the prefix even if it reaches the transport', async () => {
    // Call the transport directly (bypasses client-level validation) to exercise the URL guard.
    const mock = sequenceFetch(jsonResponse({}));
    const http = makeHttp(mock);
    await expect(http.request({ method: 'GET', path: '/../admin' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    await expect(http.request({ method: 'GET', path: '/%2e%2e/admin' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    expect(mock.calls).toHaveLength(0); // origin never contacted, no token sent
  });

  it('a resource call with a valid id keeps the origin and prefix', async () => {
    const mock = sequenceFetch(jsonResponse({ name: 'W', is_active: true, id: 9 }));
    await new WarehousesResource(makeHttp(mock)).getById(9);
    const url = new URL(mock.calls[0]!.url);
    expect(url.origin).toBe('https://test.icarry.com');
    expect(url.pathname.startsWith('/api-frontend/')).toBe(true);
  });
});
