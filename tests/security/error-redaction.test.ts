import { describe, it, expect } from 'vitest';
import { redactString, sanitizeErrorCause } from '../../src/transport/redaction';
import { ICarryNetworkError, ICarryApiError, ICarryAuthenticationError } from '../../src/errors';
import { ICarryClient } from '../../src/client';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse, textResponse, problemDetails } from '../helpers/mockFetch';

const PAN = '1111222233334444';
const CVV = 'cardCVV=123';
const SENSITIVE_URL = `https://host/api-frontend/SmartwareShipment/CreateShipmentOrder/7?cardNumber=${PAN}&${CVV}`;
const BEARER = 'Bearer abc.def.ghijkl';

function serialize(error: unknown): string {
  const e = error as { message?: string; cause?: unknown; details?: unknown };
  return JSON.stringify({
    message: e.message,
    cause: e.cause instanceof Error ? { name: e.cause.name, message: e.cause.message } : e.cause,
    details: e.details,
    string: String(error),
  });
}

function assertClean(error: unknown): void {
  const s = serialize(error);
  expect(s).not.toContain(PAN);
  expect(s).not.toContain('123'); // the CVV value
  expect(s).not.toContain('abc.def.ghijkl');
}

describe('redactString', () => {
  it('masks embedded URLs, bearer tokens, key=value secrets, and PANs', () => {
    const out = redactString(
      `failed at ${SENSITIVE_URL} with ${BEARER} password=hunter2 token: xyz pan ${PAN}`
    );
    expect(out).not.toContain(PAN);
    expect(out).not.toContain('abc.def.ghijkl');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('cardNumber=[REDACTED]');
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).toContain('password=[REDACTED]');
  });

  it('does not over-redact ordinary text', () => {
    expect(redactString('shipment created successfully')).toBe('shipment created successfully');
  });
});

describe('sanitizeErrorCause', () => {
  it('returns a minimal Error with sanitized message and no extra props', () => {
    const raw = new TypeError(`fetch failed for ${SENSITIVE_URL} ${BEARER}`);
    (raw as unknown as { request?: unknown }).request = { url: SENSITIVE_URL };
    (raw as unknown as { code?: string }).code = 'ECONNRESET';
    const safe = sanitizeErrorCause(raw)!;
    expect(safe).toBeInstanceOf(Error);
    expect(safe).not.toBe(raw);
    expect(safe.name).toBe('TypeError');
    expect((safe as unknown as { code?: string }).code).toBe('ECONNRESET');
    expect((safe as unknown as { request?: unknown }).request).toBeUndefined();
    expect(safe.message).not.toContain(PAN);
    expect(safe.message).not.toContain('abc.def.ghijkl');
  });

  it('returns undefined for nullish input', () => {
    expect(sanitizeErrorCause(undefined)).toBeUndefined();
    expect(sanitizeErrorCause(null)).toBeUndefined();
  });
});

describe('transport error redaction', () => {
  it('network error message and cause never leak sensitive data', async () => {
    const http = makeHttp(
      sequenceFetch(() => {
        throw new TypeError(`Request to ${SENSITIVE_URL} failed; ${BEARER}`);
      })
    );
    try {
      await http.request({ method: 'POST', path: '/x', body: {} });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryNetworkError);
      assertClean(error);
      // cause is a sanitized Error, not the raw thrown object.
      const cause = (error as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).not.toContain(PAN);
    }
  });

  it('API plain-text error body with a sensitive URL is sanitized', async () => {
    const http = makeHttp(sequenceFetch(textResponse(`Declined at ${SENSITIVE_URL}`, 400)));
    try {
      await http.request({ method: 'GET', path: '/x' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryApiError);
      assertClean(error);
    }
  });

  it('API JSON ProblemDetails with sensitive fields is sanitized', async () => {
    const http = makeHttp(
      sequenceFetch(
        problemDetails(400, `Failed ${SENSITIVE_URL}`, { extra: `token=${'sekret'} pan ${PAN}` })
      )
    );
    try {
      await http.request({ method: 'GET', path: '/x' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryApiError);
      assertClean(error);
      expect(serialize(error)).not.toContain('sekret');
    }
  });

  it('auth-provider error containing a token is sanitized into ICarryAuthenticationError', async () => {
    const client = new ICarryClient({
      baseUrl: 'https://test.icarry.com',
      tokenProvider: async () => {
        throw new Error(
          'provider blew up: token=SUPER_SECRET_TOKEN Authorization: Bearer leaky.tok'
        );
      },
      fetch: (async () => jsonResponse([])) as never,
    });
    try {
      await client.countries.list();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryAuthenticationError);
      const s = serialize(error);
      expect(s).not.toContain('SUPER_SECRET_TOKEN');
      expect(s).not.toContain('leaky.tok');
    }
  });
});
