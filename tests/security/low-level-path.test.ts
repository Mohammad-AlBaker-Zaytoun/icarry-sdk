import { describe, it, expect } from 'vitest';
import { ICarryClient } from '../../src/client';
import { ICarryValidationError, ICarryApiError } from '../../src/errors';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';

function client(mockFetch: (u: string, i: RequestInit) => Promise<Response>): ICarryClient {
  return new ICarryClient({
    baseUrl: 'https://test.icarry.com',
    token: 't',
    fetch: mockFetch as never,
  });
}

describe('low-level request path safety', () => {
  it('rejects a query string in path before any fetch runs', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await expect(
      client(mock.fetch).request({ method: 'GET', path: '/x?token=secret' })
    ).rejects.toBeInstanceOf(ICarryValidationError);
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects a fragment, absolute URL, control char, and empty path', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const c = client(mock.fetch);
    await expect(c.request({ method: 'GET', path: '/x#frag' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    await expect(
      c.request({ method: 'GET', path: 'https://evil.com/steal' })
    ).rejects.toBeInstanceOf(ICarryValidationError);
    await expect(c.request({ method: 'GET', path: '//evil.com' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    await expect(c.request({ method: 'GET', path: '/x\ny' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    await expect(c.request({ method: 'GET', path: '' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
    expect(mock.calls).toHaveLength(0);
  });

  it('accepts a normal path with a query object', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: 1 }));
    await client(mock.fetch).request({ method: 'GET', path: '/Some/Endpoint', query: { a: '1' } });
    expect(mock.calls[0]?.url).toBe('https://test.icarry.com/api-frontend/Some/Endpoint?a=1');
  });

  it('metadata path never contains a query even if an internal spec.path violates the contract', async () => {
    // Call the transport directly, bypassing client-level path validation.
    const paths: string[] = [];
    const http = makeHttp(sequenceFetch(stringError(400, 'nope')), {
      hooks: { onRequest: (info) => void paths.push(info.path) },
    });
    try {
      await http.request({ method: 'GET', path: '/leak?token=secret&cardNumber=1111222233334444' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryApiError);
      const detailsPath = (error as ICarryApiError).details?.path ?? '';
      expect(detailsPath).not.toContain('?');
      expect(detailsPath).not.toContain('token');
      expect(detailsPath).toBe('/api-frontend/leak');
    }
    expect(paths[0]).toBe('/api-frontend/leak');
    expect(paths[0]).not.toContain('?');
  });
});
