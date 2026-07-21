import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../src/config';
import { ICarryConfigurationError } from '../src/errors';

const fetchStub = (async () => new Response('{}')) as unknown as typeof globalThis.fetch;

describe('normalizeConfig', () => {
  it('requires a baseUrl', () => {
    expect(() => normalizeConfig({ baseUrl: '' } as never)).toThrow(ICarryConfigurationError);
  });

  it('requires an absolute http(s) baseUrl', () => {
    expect(() => normalizeConfig({ baseUrl: 'test.icarry.com', fetch: fetchStub })).toThrow(
      ICarryConfigurationError
    );
  });

  it('normalizes a trailing slash', () => {
    const cfg = normalizeConfig({
      baseUrl: 'https://test.icarry.com/',
      token: 't',
      fetch: fetchStub,
    });
    expect(cfg.baseUrl).toBe('https://test.icarry.com');
  });

  it('resolves credentials mode', () => {
    const cfg = normalizeConfig({
      baseUrl: 'https://x.com',
      email: 'a@b.com',
      password: 'pw',
      fetch: fetchStub,
    });
    expect(cfg.auth.mode).toBe('credentials');
    expect(cfg.auth.canReacquire).toBe(true);
  });

  it('resolves static token mode (not re-acquirable)', () => {
    const cfg = normalizeConfig({ baseUrl: 'https://x.com', token: 't', fetch: fetchStub });
    expect(cfg.auth.mode).toBe('static');
    expect(cfg.auth.canReacquire).toBe(false);
    expect(cfg.auth.initialToken).toBe('t');
  });

  it('resolves provider mode', () => {
    const cfg = normalizeConfig({
      baseUrl: 'https://x.com',
      tokenProvider: async () => 'tok',
      fetch: fetchStub,
    });
    expect(cfg.auth.mode).toBe('provider');
    expect(cfg.auth.canReacquire).toBe(true);
  });

  it('allows no-auth (manual setToken later)', () => {
    const cfg = normalizeConfig({ baseUrl: 'https://x.com', fetch: fetchStub });
    expect(cfg.auth.mode).toBe('none');
  });

  it('rejects tokenProvider combined with credentials', () => {
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        tokenProvider: async () => 't',
        email: 'a@b.com',
        password: 'p',
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
  });

  it('rejects email without password', () => {
    expect(() =>
      normalizeConfig({ baseUrl: 'https://x.com', email: 'a@b.com', fetch: fetchStub })
    ).toThrow(ICarryConfigurationError);
  });

  it('warm-starts credentials mode with a provided token', () => {
    const cfg = normalizeConfig({
      baseUrl: 'https://x.com',
      email: 'a@b.com',
      password: 'p',
      token: 'warm',
      fetch: fetchStub,
    });
    expect(cfg.auth.mode).toBe('credentials');
    expect(cfg.auth.initialToken).toBe('warm');
  });

  it('resolves retry policy variants', () => {
    expect(
      normalizeConfig({ baseUrl: 'https://x.com', token: 't', retry: false, fetch: fetchStub })
        .retryPolicy.maxRetries
    ).toBe(0);
    expect(
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        retry: { maxRetries: 5 },
        fetch: fetchStub,
      }).retryPolicy.maxRetries
    ).toBe(5);
    expect(
      normalizeConfig({ baseUrl: 'https://x.com', token: 't', fetch: fetchStub }).retryPolicy
        .maxRetries
    ).toBeGreaterThan(0);
  });

  it('rejects a non-positive timeout', () => {
    expect(() =>
      normalizeConfig({ baseUrl: 'https://x.com', token: 't', timeoutMs: 0, fetch: fetchStub })
    ).toThrow(ICarryConfigurationError);
  });

  it('rejects remote http but allows local http', () => {
    expect(() =>
      normalizeConfig({ baseUrl: 'http://test.icarry.com', token: 't', fetch: fetchStub })
    ).toThrow(ICarryConfigurationError);
    expect(
      normalizeConfig({ baseUrl: 'http://localhost:3000', token: 't', fetch: fetchStub }).baseUrl
    ).toBe('http://localhost:3000');
  });

  it('rejects a baseUrl with credentials, query, or fragment', () => {
    for (const bad of ['https://u:p@x.com', 'https://x.com?token=secret', 'https://x.com#frag']) {
      expect(() => normalizeConfig({ baseUrl: bad, token: 't', fetch: fetchStub })).toThrow(
        ICarryConfigurationError
      );
    }
  });

  it('rejects invalid retry policy values', () => {
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        retry: { maxRetries: -1 },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        retry: { maxRetries: 1.5 },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        retry: { retryableStatuses: [99] },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        retry: { baseDelayMs: -5 },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
  });

  it('rejects a userAgent or headers containing CR/LF', () => {
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        userAgent: 'evil\r\nX-Injected: 1',
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        headers: { 'X-Trace': 'ok\r\nX-Injected: 1' },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
    expect(() =>
      normalizeConfig({
        baseUrl: 'https://x.com',
        token: 't',
        headers: { 'Bad Name': 'ok' },
        fetch: fetchStub,
      })
    ).toThrow(ICarryConfigurationError);
  });
});
