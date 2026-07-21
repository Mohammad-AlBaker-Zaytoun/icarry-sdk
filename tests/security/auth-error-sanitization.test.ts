import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { ICarryClient } from '../../src/client';
import { ICarryAuthenticationError, ICarryApiError } from '../../src/errors';

const SECRETS = [
  'SUPER_SECRET',
  'hunter2',
  'abc.def.ghijkl',
  '1111222233334444',
  'leaky.tok',
  'shopsecret',
];

function fullyClean(error: unknown): void {
  const e = error as { message?: string; cause?: unknown; details?: unknown };
  const surfaces = [
    e.message ?? '',
    String(error),
    util.inspect(error, { depth: 6 }),
    JSON.stringify({
      message: e.message,
      cause: e.cause instanceof Error ? { name: e.cause.name, message: e.cause.message } : e.cause,
      details: e.details,
    }),
    e.cause instanceof Error ? e.cause.message : String(e.cause ?? ''),
  ].join('\n');
  for (const secret of SECRETS) {
    expect(surfaces).not.toContain(secret);
  }
}

function clientWithProvider(provider: () => Promise<string>): ICarryClient {
  return new ICarryClient({
    baseUrl: 'https://test.icarry.com',
    tokenProvider: provider,
    fetch: (async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never,
  });
}

describe('authentication error sanitization', () => {
  it('re-sanitizes an ICarryAuthenticationError thrown by a token provider (no unchanged rethrow)', async () => {
    const client = clientWithProvider(async () => {
      throw new ICarryAuthenticationError(
        'Bearer SUPER_SECRET password=hunter2 token=abc.def.ghijkl'
      );
    });
    try {
      await client.countries.list();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryAuthenticationError);
      fullyClean(error);
    }
  });

  it('sanitizes a provider error carrying a card number, sensitive URL, and auth header', async () => {
    const client = clientWithProvider(async () => {
      throw new Error(
        'auth failed at https://host/pay?cardNumber=1111222233334444&token=SUPER_SECRET Authorization: Bearer leaky.tok'
      );
    });
    try {
      await client.countries.list();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryAuthenticationError);
      fullyClean(error);
    }
  });

  it('sanitizes a provider error whose name and code embed secrets', async () => {
    const client = clientWithProvider(async () => {
      const err = new Error('nope');
      err.name = 'Bearer SUPER_SECRET';
      (err as { code?: string }).code = 'token=abc.def.ghijkl';
      throw err;
    });
    try {
      await client.countries.list();
      throw new Error('should have thrown');
    } catch (error) {
      fullyClean(error);
      const cause = (error as { cause?: unknown }).cause as Error | undefined;
      // name falls back to a safe value; code is dropped (contained a secret).
      expect(cause?.name).toBe('Error');
      expect((cause as unknown as { code?: string })?.code).toBeUndefined();
    }
  });

  it('sanitizes an ICarryAuthenticationError carrying sensitive details', async () => {
    const client = clientWithProvider(async () => {
      throw new ICarryAuthenticationError('auth broke', {
        details: {
          status: 401,
          method: 'POST',
          path: '/api-frontend/Authenticate?token=SUPER_SECRET',
          code: 'token=abc.def.ghijkl',
          requestId: 'Bearer leaky.tok',
          details: {
            note: 'card 1111222233334444',
            shopUrl: 'https://shop/success?token=shopsecret',
          },
        },
      });
    });
    try {
      await client.countries.list();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryAuthenticationError);
      fullyClean(error);
      const details = (error as ICarryApiError).details;
      expect(JSON.stringify(details)).not.toContain('SUPER_SECRET');
      expect(details?.path ?? '').not.toContain('?'); // query stripped from path
    }
  });

  it('still surfaces the SDK auth-error for a missing-auth client (safe message preserved)', async () => {
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      fetch: (async () => new Response('[]')) as never,
    });
    await expect(client.countries.list()).rejects.toBeInstanceOf(ICarryAuthenticationError);
  });
});
