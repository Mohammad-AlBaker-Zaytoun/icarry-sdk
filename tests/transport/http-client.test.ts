import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, type HttpClientDeps } from '../../src/transport/http-client';
import { TokenManager } from '../../src/transport/token-manager';
import {
  ICarryApiError,
  ICarryAuthenticationError,
  ICarryNetworkError,
  ICarryTimeoutError,
  ICarryAbortError,
} from '../../src/errors';
import {
  jsonResponse,
  emptyResponse,
  textResponse,
  problemDetails,
  stringError,
  sequenceFetch,
  hangingFetch,
  type MockFetch,
} from '../helpers/mockFetch';

const fastPolicy = {
  maxRetries: 2,
  baseDelayMs: 0,
  maxDelayMs: 0,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

interface Overrides {
  token?: string;
  canReacquire?: boolean;
  acquire?: () => Promise<string>;
  autoReauth?: boolean;
  timeoutMs?: number;
  baseUrl?: string;
  hooks?: HttpClientDeps['hooks'];
  fetch?: HttpClientDeps['fetch'];
  redactEmail?: boolean;
}

function makeClient(o: Overrides = {}): HttpClient {
  const tmOpts = {
    acquire: o.acquire ?? (async () => 'tok'),
    canReacquire: o.canReacquire ?? true,
    ...(o.token !== undefined ? { initialToken: o.token } : {}),
  };
  return new HttpClient({
    baseUrl: o.baseUrl ?? 'https://test.icarry.com',
    fetch: o.fetch ?? (async () => jsonResponse({})),
    timeoutMs: o.timeoutMs ?? 30_000,
    tokenManager: new TokenManager(tmOpts),
    retryPolicy: fastPolicy,
    hooks: o.hooks ?? {},
    defaultHeaders: {},
    userAgent: 'icarry-sdk/test',
    autoReauth: o.autoReauth ?? true,
    redactEmail: o.redactEmail ?? false,
  });
}

const headersOf = (mock: MockFetch, i = 0) => mock.calls[i]?.init.headers as Record<string, string>;

describe('HttpClient — request assembly', () => {
  it('builds the full URL with api prefix, path params, and query', async () => {
    const mock = sequenceFetch(jsonResponse({ id: 5 }));
    const client = makeClient({ fetch: mock.fetch });
    await client.request({
      method: 'GET',
      path: '/Country/GetById/5',
      query: { addSelectStateItem: true },
    });
    expect(mock.calls[0]?.url).toBe(
      'https://test.icarry.com/api-frontend/Country/GetById/5?addSelectStateItem=true'
    );
  });

  it('normalizes a trailing slash on baseUrl', async () => {
    const mock = sequenceFetch(jsonResponse([]));
    const client = makeClient({ fetch: mock.fetch, baseUrl: 'https://test.icarry.com/' });
    await client.request({ method: 'GET', path: '/Warehouse/GetAll' });
    expect(mock.calls[0]?.url).toBe('https://test.icarry.com/api-frontend/Warehouse/GetAll');
  });

  it('sends the bearer token, Accept, and User-Agent; no Content-Type on GET', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const client = makeClient({ fetch: mock.fetch });
    await client.request({ method: 'GET', path: '/Country/GetAllCountry' });
    const h = headersOf(mock);
    expect(h.Authorization).toBe('Bearer tok');
    expect(h.Accept).toContain('application/json');
    expect(h['User-Agent']).toBe('icarry-sdk/test');
    expect(h['Content-Type']).toBeUndefined();
  });

  it('serializes a JSON body and sets Content-Type on POST', async () => {
    const mock = sequenceFetch(jsonResponse({ ok: true }));
    const client = makeClient({ fetch: mock.fetch });
    await client.request({ method: 'POST', path: '/x', body: { a: 1, b: 'two' } });
    expect(headersOf(mock)['Content-Type']).toBe('application/json');
    expect(mock.lastBody()).toEqual({ a: 1, b: 'two' });
  });

  it('does not mutate the caller body or headers', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const client = makeClient({ fetch: mock.fetch });
    const body = { nested: { value: 1 } };
    const headers = { 'X-Custom': 'v' };
    const bodySnapshot = JSON.stringify(body);
    await client.request({ method: 'POST', path: '/x', body, headers });
    expect(JSON.stringify(body)).toBe(bodySnapshot);
    expect(headers).toEqual({ 'X-Custom': 'v' });
    expect(headersOf(mock)['X-Custom']).toBe('v');
  });

  it('omits Authorization and never acquires a token when auth:false', async () => {
    const acquire = vi.fn(async () => 'should-not-run');
    const mock = sequenceFetch(jsonResponse({ token: 't' }));
    const client = makeClient({ fetch: mock.fetch, acquire });
    await client.request({
      method: 'POST',
      path: '/Authenticate/GetTokenForCustomerApi',
      auth: false,
      body: {},
    });
    expect(headersOf(mock).Authorization).toBeUndefined();
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe('HttpClient — response handling', () => {
  it('unwraps JSON', async () => {
    const client = makeClient({ fetch: async () => jsonResponse({ hello: 'world' }) });
    expect(await client.request({ method: 'GET', path: '/x' })).toEqual({ hello: 'world' });
  });

  it('unwraps empty (204) to undefined', async () => {
    const client = makeClient({ fetch: async () => emptyResponse(204) });
    expect(await client.request({ method: 'GET', path: '/x' })).toBeUndefined();
  });

  it('unwraps text', async () => {
    const client = makeClient({ fetch: async () => textResponse('pong') });
    expect(await client.request({ method: 'GET', path: '/x', expect: 'text' })).toBe('pong');
  });
});

describe('HttpClient — error mapping', () => {
  it('maps ProblemDetails to ICarryApiError with safe details', async () => {
    const mock = sequenceFetch(problemDetails(404, 'Not found', { code: 'NOT_FOUND' }));
    const client = makeClient({ fetch: mock.fetch });
    await expect(
      client.request({ method: 'GET', path: '/Country/GetById/9?secret=x' })
    ).rejects.toMatchObject({
      name: 'ICarryApiError',
      status: 404,
    });
    try {
      await client.request({ method: 'GET', path: '/Country/GetById/9' });
    } catch (e) {
      const err = e as ICarryApiError;
      expect(err.details?.code).toBe('NOT_FOUND');
      expect(err.details?.path).toBe('/api-frontend/Country/GetById/9');
      expect(err.message).toContain('Not found');
    }
  });

  it('maps a bare-string error body', async () => {
    const client = makeClient({ fetch: async () => stringError(400, 'Bad request text') });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow('Bad request text');
  });

  it('maps 401 to ICarryAuthenticationError when it cannot be recovered', async () => {
    const client = makeClient({
      fetch: async () => stringError(401, 'Unauthorized'),
      token: 'static',
      canReacquire: false,
    });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      ICarryAuthenticationError
    );
  });

  it('maps a network failure to ICarryNetworkError', async () => {
    const client = makeClient({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(client.request({ method: 'POST', path: '/x', body: {} })).rejects.toBeInstanceOf(
      ICarryNetworkError
    );
  });
});

describe('HttpClient — 401 re-auth', () => {
  it('re-authenticates once and retries when the SDK owns the token', async () => {
    const acquire = vi.fn(async () => 'fresh-token');
    const mock = sequenceFetch(stringError(401, 'Unauthorized'), jsonResponse({ ok: true }));
    const client = makeClient({ fetch: mock.fetch, acquire, canReacquire: true });
    const result = await client.request({ method: 'GET', path: '/x' });
    expect(result).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(2);
    expect(acquire).toHaveBeenCalledTimes(2); // initial + one re-auth
    expect(headersOf(mock, 1).Authorization).toBe('Bearer fresh-token');
  });

  it('does not loop: a second 401 after re-auth throws', async () => {
    const acquire = vi.fn(async () => 'tok');
    const mock = sequenceFetch(stringError(401, 'no'), stringError(401, 'still no'));
    const client = makeClient({ fetch: mock.fetch, acquire });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      ICarryAuthenticationError
    );
    expect(mock.calls).toHaveLength(2);
  });

  it('does not re-auth when autoReauth is disabled', async () => {
    const acquire = vi.fn(async () => 'tok');
    const mock = sequenceFetch(stringError(401, 'no'));
    const client = makeClient({ fetch: mock.fetch, acquire, autoReauth: false });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      ICarryAuthenticationError
    );
    expect(mock.calls).toHaveLength(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

describe('HttpClient — retry policy', () => {
  it('retries a retryable GET on 503 then succeeds', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const client = makeClient({ fetch: mock.fetch });
    const result = await client.request({ method: 'GET', path: '/x', retryable: true });
    expect(result).toEqual({ ok: 1 });
    expect(mock.calls).toHaveLength(2);
  });

  it('retries on 429', async () => {
    const mock = sequenceFetch(stringError(429, 'slow down'), jsonResponse({ ok: 1 }));
    const client = makeClient({ fetch: mock.fetch });
    await client.request({ method: 'GET', path: '/x', retryable: true });
    expect(mock.calls).toHaveLength(2);
  });

  it('does NOT retry a non-retryable (mutating) call', async () => {
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const client = makeClient({ fetch: mock.fetch });
    await expect(
      client.request({ method: 'POST', path: '/SmartwareShipment/CreateOrder', body: {} })
    ).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it('caps the number of retries', async () => {
    const mock = sequenceFetch(
      stringError(503, 'a'),
      stringError(503, 'b'),
      stringError(503, 'c'),
      stringError(503, 'd')
    );
    const client = makeClient({ fetch: mock.fetch });
    await expect(
      client.request({ method: 'GET', path: '/x', retryable: true })
    ).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(3); // initial + 2 retries
  });

  it('does not retry a 4xx client error', async () => {
    const mock = sequenceFetch(stringError(400, 'bad'), jsonResponse({}));
    const client = makeClient({ fetch: mock.fetch });
    await expect(
      client.request({ method: 'GET', path: '/x', retryable: true })
    ).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('HttpClient — timeout & abort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('raises ICarryTimeoutError when the timeout elapses', async () => {
    const client = makeClient({ fetch: hangingFetch(), timeoutMs: 1000 });
    const p = client.request({ method: 'GET', path: '/x' });
    const assertion = expect(p).rejects.toBeInstanceOf(ICarryTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('reports the per-call timeout (not the client default) in the message', async () => {
    const client = makeClient({ fetch: hangingFetch() }); // client default is 30_000ms
    const caught = client.request({ method: 'GET', path: '/x', timeoutMs: 500 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    const err = await caught;
    expect(err).toBeInstanceOf(ICarryTimeoutError);
    expect((err as Error).message).toContain('500ms');
  });

  it('raises ICarryAbortError when the caller aborts', async () => {
    const controller = new AbortController();
    const client = makeClient({ fetch: hangingFetch(), timeoutMs: 60_000 });
    const p = client.request({ method: 'GET', path: '/x', signal: controller.signal });
    const assertion = expect(p).rejects.toBeInstanceOf(ICarryAbortError);
    controller.abort();
    await assertion;
  });
});

describe('HttpClient — hooks & redaction', () => {
  it('passes redacted request info to onRequest (Authorization + body secrets masked)', async () => {
    const seen: unknown[] = [];
    const client = makeClient({
      fetch: async () => jsonResponse({}),
      hooks: { onRequest: (info) => void seen.push(info) },
    });
    await client.request({
      method: 'POST',
      path: '/x',
      body: { password: 'hunter2', cardNumber: '1111222233334444', note: 'ok' },
    });
    const info = seen[0] as {
      headers: Record<string, string>;
      body: Record<string, unknown>;
      url: string;
    };
    expect(info.headers.Authorization).toBe('[REDACTED]');
    expect(info.body.password).toBe('[REDACTED]');
    expect(info.body.cardNumber).toBe('************4444');
    expect(info.body.note).toBe('ok');
  });

  it('redacts sensitive query params in the hook url', async () => {
    const seen: string[] = [];
    const client = makeClient({
      fetch: async () => jsonResponse({}),
      hooks: { onRequest: (info) => void seen.push(info.url) },
    });
    await client.request({
      method: 'POST',
      path: '/SmartwareShipment/CreateShipmentOrder/7',
      auth: true,
      query: {
        cardNumber: '1111222233334444',
        cardCVV: '123',
        paymentMethodSystemName: 'Payments.MontyPay',
      },
    });
    expect(seen[0]).toContain('cardNumber=[REDACTED]');
    expect(seen[0]).toContain('cardCVV=[REDACTED]');
    expect(seen[0]).not.toContain('1111222233334444');
    expect(seen[0]).toContain('paymentMethodSystemName=Payments.MontyPay');
  });

  it('a throwing hook never fails the request', async () => {
    const client = makeClient({
      fetch: async () => jsonResponse({ ok: true }),
      hooks: {
        onRequest: () => {
          throw new Error('hook boom');
        },
      },
    });
    await expect(client.request({ method: 'GET', path: '/x' })).resolves.toEqual({ ok: true });
  });

  it('fires onRetry before retrying', async () => {
    const events: unknown[] = [];
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    const client = makeClient({
      fetch: mock.fetch,
      hooks: { onRetry: (e) => void events.push(e) },
    });
    await client.request({ method: 'GET', path: '/x', retryable: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'status', status: 503 });
  });
});

describe('HttpClient — auth acquisition failure', () => {
  it('wraps an acquisition failure in ICarryAuthenticationError', async () => {
    const client = makeClient({
      acquire: async () => {
        throw new Error('credentials rejected');
      },
    });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      ICarryAuthenticationError
    );
  });
});
