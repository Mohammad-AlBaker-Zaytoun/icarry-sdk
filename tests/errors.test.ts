import { describe, it, expect } from 'vitest';
import {
  ICarryError,
  ICarryConfigurationError,
  ICarryValidationError,
  ICarryAuthenticationError,
  ICarryApiError,
  ICarryNetworkError,
  ICarryTimeoutError,
  ICarryAbortError,
  ICarryResponseParseError,
  ERROR_CODES,
} from '../src/errors';

describe('errors', () => {
  const cases = [
    [new ICarryConfigurationError('x'), 'ICarryConfigurationError', ERROR_CODES.CONFIGURATION],
    [new ICarryValidationError('x'), 'ICarryValidationError', ERROR_CODES.VALIDATION],
    [new ICarryAuthenticationError('x'), 'ICarryAuthenticationError', ERROR_CODES.AUTHENTICATION],
    [new ICarryApiError('x'), 'ICarryApiError', ERROR_CODES.API],
    [new ICarryNetworkError('x'), 'ICarryNetworkError', ERROR_CODES.NETWORK],
    [new ICarryTimeoutError('x'), 'ICarryTimeoutError', ERROR_CODES.TIMEOUT],
    [new ICarryAbortError('x'), 'ICarryAbortError', ERROR_CODES.ABORT],
    [new ICarryResponseParseError('x'), 'ICarryResponseParseError', ERROR_CODES.RESPONSE_PARSE],
  ] as const;

  it('every subclass is instanceof ICarryError and Error', () => {
    for (const [err] of cases) {
      expect(err).toBeInstanceOf(ICarryError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('sets the correct name and stable code', () => {
    for (const [err, name, code] of cases) {
      expect(err.name).toBe(name);
      expect(err.code).toBe(code);
    }
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('root');
    const err = new ICarryNetworkError('wrapped', { cause });
    expect(err.cause).toBe(cause);
  });

  it('ICarryValidationError carries the offending field', () => {
    const err = new ICarryValidationError('bad', 'amount');
    expect(err.field).toBe('amount');
  });

  it('ICarryApiError exposes safe details (status, requestId)', () => {
    const err = new ICarryApiError('boom', {
      details: { status: 404, method: 'GET', path: '/Country/GetById', requestId: 'req-1' },
    });
    expect(err.status).toBe(404);
    expect(err.requestId).toBe('req-1');
    expect(err.details?.path).toBe('/Country/GetById');
  });

  it('is throwable and catchable by base type', () => {
    expect(() => {
      throw new ICarryTimeoutError('t');
    }).toThrow(ICarryError);
  });

  it('has a usable stack trace', () => {
    const err = new ICarryApiError('with-stack');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('ICarryApiError');
  });
});
