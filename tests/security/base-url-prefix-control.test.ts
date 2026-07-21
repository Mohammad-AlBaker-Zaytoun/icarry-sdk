import { describe, it, expect } from 'vitest';
import { validateAndNormalizeBaseUrl, resolveApiRoot } from '../../src/transport/url';
import { ICarryConfigurationError } from '../../src/errors';

describe('duplicate /api-frontend prefix rejection (segment-aware)', () => {
  it('accepts origin only and a single prefix (any case)', () => {
    expect(validateAndNormalizeBaseUrl('https://test.icarry.com')).toBe('https://test.icarry.com');
    expect(validateAndNormalizeBaseUrl('https://test.icarry.com/api-frontend')).toBe(
      'https://test.icarry.com/api-frontend'
    );
    expect(validateAndNormalizeBaseUrl('https://test.icarry.com/API-Frontend')).toBe(
      'https://test.icarry.com/API-Frontend'
    );
  });

  it('accepts a custom base path (with or without a single prefix)', () => {
    expect(validateAndNormalizeBaseUrl('https://proxy.example.com/icarry')).toBe(
      'https://proxy.example.com/icarry'
    );
    expect(validateAndNormalizeBaseUrl('https://proxy.example.com/icarry/api-frontend')).toBe(
      'https://proxy.example.com/icarry/api-frontend'
    );
  });

  it('does not mistake a partial-segment match for the prefix', () => {
    expect(validateAndNormalizeBaseUrl('https://test.icarry.com/my-api-frontend-proxy')).toBe(
      'https://test.icarry.com/my-api-frontend-proxy'
    );
  });

  it('rejects duplicate, mixed-case duplicate, and triple prefixes', () => {
    for (const bad of [
      'https://test.icarry.com/api-frontend/api-frontend',
      'https://test.icarry.com/API-Frontend/api-frontend',
      'https://test.icarry.com/api-frontend/API-FRONTEND',
      'https://test.icarry.com/api-frontend/api-frontend/api-frontend',
      'https://test.icarry.com/api-frontend/api-frontend/',
    ]) {
      expect(() => validateAndNormalizeBaseUrl(bad)).toThrow(ICarryConfigurationError);
      expect(() => validateAndNormalizeBaseUrl(bad)).toThrow(/at most once/);
    }
  });

  it('resolveApiRoot enforces the same invariant and appends the prefix exactly once', () => {
    expect(resolveApiRoot('https://test.icarry.com').pathname).toBe('/api-frontend');
    expect(resolveApiRoot('https://test.icarry.com/api-frontend').pathname).toBe('/api-frontend');
    expect(resolveApiRoot('https://proxy.example.com/icarry').pathname).toBe(
      '/icarry/api-frontend'
    );
    expect(() => resolveApiRoot('https://test.icarry.com/api-frontend/api-frontend')).toThrow(
      ICarryConfigurationError
    );
  });

  it('final API root contains /api-frontend exactly once', () => {
    for (const base of [
      'https://test.icarry.com',
      'https://test.icarry.com/api-frontend',
      'https://proxy.example.com/icarry',
    ]) {
      const root = resolveApiRoot(validateAndNormalizeBaseUrl(base));
      const occurrences = root.pathname.toLowerCase().split('/api-frontend').length - 1;
      expect(occurrences).toBe(1);
    }
  });
});

describe('raw baseUrl control-character rejection (before trimming)', () => {
  const CR = String.fromCharCode(0x0d);
  const LF = String.fromCharCode(0x0a);
  const TAB = String.fromCharCode(0x09);
  const NUL = String.fromCharCode(0x00);
  const DEL = String.fromCharCode(0x7f);
  const HOST = 'https://test.icarry.com';

  it('accepts only ordinary surrounding spaces', () => {
    expect(validateAndNormalizeBaseUrl(` ${HOST} `)).toBe(HOST);
  });

  it('rejects CR, LF, tab, NUL, and DEL even when trimming would hide them', () => {
    const bad = [LF + HOST, HOST + CR, TAB + HOST, HOST + NUL, HOST + DEL];
    for (const input of bad) {
      expect(() => validateAndNormalizeBaseUrl(input)).toThrow(ICarryConfigurationError);
      expect(() => validateAndNormalizeBaseUrl(input)).toThrow(/control characters/);
    }
  });
});
