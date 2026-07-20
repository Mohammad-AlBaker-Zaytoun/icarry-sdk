import { describe, it, expect, vi } from 'vitest';
import { ICarryClient } from '../src/client';
import { ICarryConfigurationError } from '../src/errors';
import { sequenceFetch, jsonResponse, stringError } from './helpers/mockFetch';

describe('ICarryClient', () => {
  it('throws on invalid configuration', () => {
    expect(() => new ICarryClient({ baseUrl: '' })).toThrow(ICarryConfigurationError);
  });

  it('exposes all resource groups', () => {
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      token: 't',
      fetch: (async () => jsonResponse({})) as never,
    });
    for (const key of [
      'auth',
      'warehouses',
      'countries',
      'merchant',
      'marketplace',
      'onDemand',
      'payments',
      'shipments',
    ]) {
      expect(client).toHaveProperty(key);
    }
    expect(client.getBaseUrl()).toBe('https://test.icarry.com');
  });

  it('the low-level request() reuses the transport', async () => {
    const mock = sequenceFetch(jsonResponse({ pong: true }));
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      token: 't',
      fetch: mock.fetch as never,
    });
    const result = await client.request<{ pong: boolean }>({
      method: 'GET',
      path: '/Future/Endpoint',
    });
    expect(result).toEqual({ pong: true });
    expect(mock.calls[0]?.url).toBe('https://test.icarry.com/api-frontend/Future/Endpoint');
    expect((mock.calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('authenticates lazily then calls the endpoint (credentials mode)', async () => {
    const mock = sequenceFetch(
      jsonResponse({ token: 'ACQUIRED' }), // auth
      jsonResponse([{ name: 'Lebanon', id: 125 }]) // countries.list
    );
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      email: 'a@b.com',
      password: 'pw',
      fetch: mock.fetch as never,
    });
    const countries = await client.countries.list();
    expect(countries[0]?.name).toBe('Lebanon');
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.url).toContain('/Authenticate/GetTokenForCustomerApi');
    expect((mock.calls[1]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ACQUIRED'
    );
  });

  it('deduplicates authentication across concurrent calls', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ token: 'ONE' }));
    const dataFetch = vi.fn(async () => jsonResponse([]));
    const fetchImpl = (async (url: string) =>
      String(url).includes('Authenticate') ? authFetch() : dataFetch()) as never;
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      email: 'a@b.com',
      password: 'pw',
      fetch: fetchImpl,
    });
    await Promise.all([client.countries.list(), client.countries.list(), client.warehouses.list()]);
    expect(authFetch).toHaveBeenCalledTimes(1); // single auth despite 3 concurrent calls
  });

  it('re-authenticates once after a 401 and retries', async () => {
    let authCount = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (String(url).includes('Authenticate')) {
        authCount += 1;
        return jsonResponse({ token: authCount === 1 ? 'STALE' : 'FRESH' });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer STALE'
        ? stringError(401, 'expired')
        : jsonResponse([{ name: 'X', id: 1 }]);
    }) as never;
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      email: 'a@b.com',
      password: 'pw',
      fetch: fetchImpl,
    });
    const result = await client.countries.list();
    expect(result[0]?.name).toBe('X');
    expect(authCount).toBe(2); // initial + one re-auth
  });
});
