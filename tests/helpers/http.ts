import { HttpClient } from '../../src/transport/http-client';
import { TokenManager } from '../../src/transport/token-manager';
import type { ICarryHooks } from '../../src/types';
import type { MockFetch } from './mockFetch';

const fastPolicy = {
  maxRetries: 2,
  baseDelayMs: 0,
  maxDelayMs: 0,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/** Builds an HttpClient wired to a mock fetch with a static token (no auth round-trips). */
export function makeHttp(mock: MockFetch, opts: { hooks?: ICarryHooks } = {}): HttpClient {
  return new HttpClient({
    baseUrl: 'https://test.icarry.com',
    fetch: mock.fetch,
    timeoutMs: 30_000,
    tokenManager: new TokenManager({
      acquire: async () => 'tok',
      canReacquire: false,
      initialToken: 'tok',
    }),
    retryPolicy: fastPolicy,
    hooks: opts.hooks ?? {},
    defaultHeaders: {},
    userAgent: 'icarry-sdk/test',
    autoReauth: true,
    redactEmail: false,
  });
}

/** Returns the JSON body sent on call `i`. */
export function sentBody(mock: MockFetch, i = 0): Record<string, unknown> {
  const body = mock.calls[i]?.init.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/** Returns the URL requested on call `i`. */
export function sentUrl(mock: MockFetch, i = 0): string {
  return mock.calls[i]?.url ?? '';
}
