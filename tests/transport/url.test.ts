import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, encodePathParam, joinPath } from '../../src/transport/url';

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://test.icarry.com/  ')).toBe('https://test.icarry.com');
    expect(normalizeBaseUrl('https://test.icarry.com///')).toBe('https://test.icarry.com');
  });
});

describe('encodePathParam', () => {
  it('percent-encodes slashes and spaces', () => {
    expect(encodePathParam('a/b 1')).toBe('a%2Fb%201');
  });
  it('accepts numbers', () => {
    expect(encodePathParam(42)).toBe('42');
  });
});

describe('joinPath', () => {
  it('appends the api prefix to a bare origin', () => {
    expect(joinPath('https://test.icarry.com', '/api-frontend', '/Country/GetAllCountry')).toBe(
      'https://test.icarry.com/api-frontend/Country/GetAllCountry'
    );
  });

  it('does not double-add the prefix when baseUrl already includes it', () => {
    expect(
      joinPath('https://test.icarry.com/api-frontend', '/api-frontend', '/Country/GetAllCountry')
    ).toBe('https://test.icarry.com/api-frontend/Country/GetAllCountry');
  });

  it('normalizes trailing slashes on baseUrl', () => {
    expect(joinPath('https://test.icarry.com/', 'api-frontend', 'Warehouse/GetAll')).toBe(
      'https://test.icarry.com/api-frontend/Warehouse/GetAll'
    );
  });
});
