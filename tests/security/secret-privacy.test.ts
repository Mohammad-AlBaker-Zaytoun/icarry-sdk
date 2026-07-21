import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { ICarryClient } from '../../src/client';
import { TokenManager } from '../../src/transport/token-manager';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';

const SECRETS = ['super-secret-pw', 'connector@example.com', 'THE_BEARER_TOKEN'];

function assertNoSecrets(text: string): void {
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

describe('runtime secret privacy', () => {
  it('ICarryClient never reveals credentials or token via serialization/enumeration/inspection', async () => {
    const mock = sequenceFetch(
      jsonResponse({ token: 'THE_BEARER_TOKEN' }), // auth
      jsonResponse([{ name: 'Lebanon', id: 125 }]) // countries.list
    );
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      email: 'connector@example.com',
      password: 'super-secret-pw',
      fetch: mock.fetch as never,
    });
    // Force a token to be acquired and cached in memory.
    await client.countries.list();

    assertNoSecrets(JSON.stringify(client));
    assertNoSecrets(JSON.stringify(Object.keys(client)));
    assertNoSecrets(JSON.stringify(Object.getOwnPropertyNames(client)));
    assertNoSecrets(String(client));
    assertNoSecrets(util.inspect(client, { depth: 6 }));

    // toJSON exposes only non-sensitive identity.
    expect(client.toJSON()).toEqual({ name: 'ICarryClient', baseUrl: 'https://test.icarry.com' });
  });

  it('AuthResource never reveals credentials', async () => {
    const mock = sequenceFetch(jsonResponse({ token: 'THE_BEARER_TOKEN' }));
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      email: 'connector@example.com',
      password: 'super-secret-pw',
      fetch: mock.fetch as never,
    });
    assertNoSecrets(JSON.stringify(client.auth));
    assertNoSecrets(util.inspect(client.auth, { depth: 6 }));
    assertNoSecrets(JSON.stringify(Object.getOwnPropertyNames(client.auth)));
  });

  it('TokenManager never reveals the cached token or acquire fn', async () => {
    const tm = new TokenManager({
      acquire: async () => 'THE_BEARER_TOKEN',
      canReacquire: true,
    });
    await tm.getToken();
    assertNoSecrets(JSON.stringify(tm));
    assertNoSecrets(util.inspect(tm, { depth: 6 }));
    assertNoSecrets(JSON.stringify(Object.getOwnPropertyNames(tm)));
    expect(tm.toJSON()).toEqual({ name: 'TokenManager', canReacquire: true });
  });

  it('a static-token client does not expose the token', () => {
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      token: 'THE_BEARER_TOKEN',
      fetch: (async () => jsonResponse({})) as never,
    });
    assertNoSecrets(JSON.stringify(client));
    assertNoSecrets(util.inspect(client, { depth: 6 }));
  });

  it('a manually-set token is not exposed', () => {
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      fetch: (async () => jsonResponse({})) as never,
    });
    client.auth.setToken('THE_BEARER_TOKEN');
    assertNoSecrets(JSON.stringify(client));
    assertNoSecrets(util.inspect(client.auth, { depth: 6 }));
  });
});
