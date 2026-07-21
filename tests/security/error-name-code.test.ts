import { describe, it, expect } from 'vitest';
import {
  sanitizeErrorName,
  sanitizeErrorCode,
  sanitizeErrorCause,
} from '../../src/transport/redaction';

describe('sanitizeErrorName', () => {
  it('keeps conservative identifier-like names', () => {
    expect(sanitizeErrorName('TypeError')).toBe('TypeError');
    expect(sanitizeErrorName('ICarryApiError')).toBe('ICarryApiError');
    expect(sanitizeErrorName('Error_1.2-3')).toBe('Error_1.2-3');
  });

  it('falls back to "Error" for names embedding secrets or bad chars', () => {
    expect(sanitizeErrorName('Bearer SUPER_SECRET')).toBe('Error'); // space
    expect(sanitizeErrorName('token=abc')).toBe('Error'); // '='
    expect(sanitizeErrorName('1111222233334444')).toBe('Error'); // starts with digit
    expect(sanitizeErrorName('Card1111222233334444')).toBe('Error'); // redactString alters (16-digit run masked)
    expect(sanitizeErrorName('bad\nname')).toBe('Error'); // control char
    expect(sanitizeErrorName(123 as unknown)).toBe('Error');
    expect(sanitizeErrorName({} as unknown)).toBe('Error');
  });

  it('length-limits the name', () => {
    const long = 'A'.repeat(200);
    expect(sanitizeErrorName(long).length).toBeLessThanOrEqual(64);
  });
});

describe('sanitizeErrorCode', () => {
  it('keeps safe string/number codes', () => {
    expect(sanitizeErrorCode('ECONNRESET')).toBe('ECONNRESET');
    expect(sanitizeErrorCode('NOT_FOUND')).toBe('NOT_FOUND');
    expect(sanitizeErrorCode(404)).toBe('404');
  });

  it('drops codes embedding secrets, control chars, or non-primitives', () => {
    expect(sanitizeErrorCode('token=SECRET')).toBeUndefined();
    expect(sanitizeErrorCode('Bearer abc.def')).toBeUndefined();
    expect(sanitizeErrorCode('1111222233334444')).toBeUndefined(); // 16-digit run masked
    expect(sanitizeErrorCode('badcode')).toBeUndefined(); // control char
    expect(sanitizeErrorCode({} as unknown)).toBeUndefined();
    expect(sanitizeErrorCode(undefined)).toBeUndefined();
    expect(sanitizeErrorCode('')).toBeUndefined();
  });

  it('length-limits the code', () => {
    const long = 'A'.repeat(200);
    const out = sanitizeErrorCode(long);
    expect(out && out.length).toBeLessThanOrEqual(64);
  });
});

describe('sanitizeErrorCause applies name/code sanitization', () => {
  it('replaces a hostile name and drops a hostile code', () => {
    const raw = new Error('boom');
    raw.name = 'Bearer SECRET';
    (raw as { code?: string }).code = 'password=hunter2';
    const safe = sanitizeErrorCause(raw)!;
    expect(safe.name).toBe('Error');
    expect((safe as unknown as { code?: string }).code).toBeUndefined();
  });

  it('keeps a safe name and code', () => {
    const raw = new TypeError('x');
    (raw as { code?: string }).code = 'ECONNRESET';
    const safe = sanitizeErrorCause(raw)!;
    expect(safe.name).toBe('TypeError');
    expect((safe as unknown as { code?: string }).code).toBe('ECONNRESET');
  });
});
