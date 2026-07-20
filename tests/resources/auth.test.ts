import { describe, it, expect } from 'vitest';
import { AuthResource, toWireAuthenticate, fromWireAuthToken } from '../../src/resources/auth';
import { TokenManager } from '../../src/transport/token-manager';
import { ICarryAuthenticationError, ICarryValidationError } from '../../src/errors';
import type { ResolvedAuth } from '../../src/config';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';

const credsAuth: ResolvedAuth = {
  mode: 'credentials',
  canReacquire: true,
  credentials: { email: 'connector@example.com', password: 'secret-pw' },
};

describe('auth serializers', () => {
  it('maps email/password to Email/Password', () => {
    expect(toWireAuthenticate({ email: 'a@b.com', password: 'p' })).toEqual({
      Email: 'a@b.com',
      Password: 'p',
    });
  });

  it('maps the wire token response to camelCase, preserving snake keys', () => {
    const res = fromWireAuthToken({
      token: 'T',
      email: 'a@b.com',
      customer_id: 7,
      api_plugin_type: 'shopify',
      site_url: 'https://s',
    });
    expect(res.token).toBe('T');
    expect(res.customerId).toBe(7);
    expect(res.apiPluginType).toBe('shopify');
    expect(res.siteUrl).toBe('https://s');
    expect(res.customer_id).toBe(7); // original preserved
  });
});

describe('AuthResource', () => {
  function wire(fetchResponses: Parameters<typeof sequenceFetch>) {
    const mock = sequenceFetch(...fetchResponses);
    const http = makeHttp(mock);
    let auth!: AuthResource;
    const tm = new TokenManager({ acquire: () => auth.acquireToken(), canReacquire: true });
    auth = new AuthResource(http, tm, credsAuth);
    return { mock, auth, tm };
  }

  it('authenticate() posts credentials and returns the token', async () => {
    const { mock, auth } = wire([jsonResponse({ token: 'T', customer_id: 1 })]);
    const res = await auth.authenticate();
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/Authenticate/GetTokenForCustomerApi'
    );
    expect(sentBody(mock)).toEqual({ Email: 'connector@example.com', Password: 'secret-pw' });
    expect(res.token).toBe('T');
  });

  it('throws when no token is returned', async () => {
    const { auth } = wire([jsonResponse({ customer_id: 1 })]);
    await expect(auth.authenticate()).rejects.toBeInstanceOf(ICarryAuthenticationError);
  });

  it('validates credentials', async () => {
    const { auth } = wire([jsonResponse({ token: 'T' })]);
    await expect(auth.authenticate({ email: '', password: 'x' })).rejects.toBeInstanceOf(
      ICarryValidationError
    );
  });

  it('getToken() caches: two calls trigger one authentication', async () => {
    const { mock, auth } = wire([jsonResponse({ token: 'T' })]);
    const a = await auth.getToken();
    const b = await auth.getToken();
    expect(a).toBe('T');
    expect(b).toBe('T');
    expect(mock.calls).toHaveLength(1);
  });

  it('setToken()/clearToken() manage the cache', async () => {
    const { auth, mock } = wire([jsonResponse({ token: 'FROM_API' })]);
    auth.setToken('MANUAL');
    expect(await auth.getToken()).toBe('MANUAL');
    expect(mock.calls).toHaveLength(0);
    expect(() => auth.setToken('')).toThrow(ICarryValidationError);
  });

  it('acquireToken() in provider mode calls the provider', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const http = makeHttp(mock);
    const providerAuth: ResolvedAuth = {
      mode: 'provider',
      canReacquire: true,
      tokenProvider: async () => 'PROVIDED',
    };
    const tm = new TokenManager({ acquire: async () => 'x', canReacquire: true });
    const auth = new AuthResource(http, tm, providerAuth);
    expect(await auth.acquireToken()).toBe('PROVIDED');
  });

  it('acquireToken() throws for static and none modes', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const http = makeHttp(mock);
    const tm = new TokenManager({ acquire: async () => 'x', canReacquire: false });
    const staticAuth = new AuthResource(http, tm, { mode: 'static', canReacquire: false });
    const noneAuth = new AuthResource(http, tm, { mode: 'none', canReacquire: false });
    await expect(staticAuth.acquireToken()).rejects.toBeInstanceOf(ICarryAuthenticationError);
    await expect(noneAuth.acquireToken()).rejects.toBeInstanceOf(ICarryAuthenticationError);
  });
});
