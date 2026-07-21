import { describe, it, expect } from 'vitest';
import { isValidHeaderName, isValidHeaderValue } from '../../src/transport/headers';

describe('isValidHeaderName', () => {
  it('accepts RFC 7230 token names', () => {
    for (const name of ['X-Trace-Id', 'Authorization', 'User-Agent', "X'Weird", 'a1']) {
      expect(isValidHeaderName(name)).toBe(true);
    }
  });

  it('rejects empty, non-string, or non-token names', () => {
    expect(isValidHeaderName('')).toBe(false);
    expect(isValidHeaderName(undefined)).toBe(false);
    expect(isValidHeaderName(42 as never)).toBe(false);
    expect(isValidHeaderName('X Trace')).toBe(false); // space
    expect(isValidHeaderName('X:Trace')).toBe(false); // colon
    expect(isValidHeaderName('X-Trace\r\nEvil')).toBe(false);
  });
});

describe('isValidHeaderValue — blocks header/response splitting', () => {
  it('accepts ordinary values and horizontal tabs', () => {
    expect(isValidHeaderValue('icarry-sdk/0.1.6')).toBe(true);
    expect(isValidHeaderValue('Bearer abc.def')).toBe(true);
    expect(isValidHeaderValue('a\tb')).toBe(true);
  });

  it('rejects CR, LF, NUL, and other control characters', () => {
    expect(isValidHeaderValue('value\r\nX-Injected: 1')).toBe(false);
    expect(isValidHeaderValue('value\nX-Injected: 1')).toBe(false);
    expect(isValidHeaderValue('value\rX-Injected: 1')).toBe(false);
    expect(isValidHeaderValue('value\x00nul')).toBe(false);
    expect(isValidHeaderValue('value\x1besc')).toBe(false);
    expect(isValidHeaderValue('value\x7fdel')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidHeaderValue(undefined)).toBe(false);
    expect(isValidHeaderValue(123 as never)).toBe(false);
    expect(isValidHeaderValue(null as never)).toBe(false);
  });
});
