import { describe, it, expect } from 'vitest';
import { buildQuery } from '../../src/transport/query';

describe('buildQuery', () => {
  it('returns empty string for undefined or empty params', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
  });

  it('encodes keys and values', () => {
    expect(buildQuery({ name: 'a b&c' })).toBe('?name=a+b%26c');
  });

  it('serializes booleans as true/false', () => {
    expect(buildQuery({ addSelectStateItem: true })).toBe('?addSelectStateItem=true');
    expect(buildQuery({ addSelectStateItem: false })).toBe('?addSelectStateItem=false');
  });

  it('skips null and undefined values entirely', () => {
    expect(buildQuery({ a: undefined, b: null, c: 1 })).toBe('?c=1');
  });

  it('repeats the key for array values, skipping nullish elements', () => {
    expect(buildQuery({ id: [1, 2, null, 3] })).toBe('?id=1&id=2&id=3');
  });

  it('serializes trackingNumber safely', () => {
    expect(buildQuery({ trackingNumber: 'ABC/123 45' })).toBe('?trackingNumber=ABC%2F123+45');
  });
});
