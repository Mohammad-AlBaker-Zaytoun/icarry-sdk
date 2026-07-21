import { describe, it, expect } from 'vitest';
import { summarizeShape, sanitizeShapeKey } from './shape';

describe('sanitizeShapeKey (allowlist-only visibility)', () => {
  it('keeps ONLY explicit allowlisted schema keys visible', () => {
    for (const k of ['id', 'name', 'status', 'createdAt', 'trackingNumber', 'warehouseId']) {
      expect(sanitizeShapeKey(k)).toBe(k);
    }
  });

  it('masks arbitrary identifier-shaped keys as [dynamic-key]', () => {
    for (const k of [
      'MohammadZaytoun',
      'CustomerABC123',
      'USR8FA92',
      'OrderReferenceXYZ',
      'ClientLebanon01',
      'randomIdentifier',
      'SomeUnknownField',
    ]) {
      const out = sanitizeShapeKey(k);
      expect(out).toBe('[dynamic-key]');
      expect(out).not.toContain(k);
    }
  });

  it('masks identifier-shaped secrets as [token-like-key]', () => {
    for (const k of [
      'BearerSecretToken',
      'SUPERSECRETTOKEN',
      'password123',
      'apiKeySecretValue',
      'AuthorizationBearer',
      'jwtTokenValue',
      'privateKeyData',
      'cardNumberSecret',
      'cvvValue',
    ]) {
      expect(sanitizeShapeKey(k)).toBe('[token-like-key]');
    }
  });

  it('masks structural key shapes', () => {
    expect(sanitizeShapeKey('person@example.com')).toBe('[email-key]');
    expect(sanitizeShapeKey('+96170123456')).toBe('[phone-key]');
    expect(sanitizeShapeKey('1111222233334444')).toBe('[numeric-key]');
    expect(sanitizeShapeKey('550e8400-e29b-41d4-a716-446655440000')).toBe('[long-id-key]');
    expect(sanitizeShapeKey('https://example.com/private')).toBe('[url-key]');
    expect(sanitizeShapeKey('a'.repeat(200))).toBe('[long-key]');
    expect(sanitizeShapeKey('col\r\nInjected')).toBe('[dynamic-key]');
    expect(sanitizeShapeKey('')).toBe('[dynamic-key]');
  });
});

describe('summarizeShape (privacy-safe, capped, collision-aggregated)', () => {
  it('summarizes primitives and nullish', () => {
    expect(summarizeShape(null)).toEqual({ kind: 'null' });
    expect(summarizeShape('x')).toEqual({ kind: 'string' });
    expect(summarizeShape(1)).toEqual({ kind: 'number' });
    expect(summarizeShape(true)).toEqual({ kind: 'boolean' });
  });

  it('shows only allowlisted keys; everything else is categorized', () => {
    const payload = {
      id: 1,
      trackingNumber: 'T',
      email: 'person@example.com', // not allowlisted → [dynamic-key]
      address: '123 St', // not allowlisted → [dynamic-key]
      MohammadZaytoun: { x: 1 }, // arbitrary identifier → [dynamic-key]
      token: 'SECRET', // sensitive → [token-like-key]
    };
    const s = summarizeShape(payload);
    const json = JSON.stringify(s);
    expect(new Set(Object.keys(s.keys ?? {}))).toEqual(
      new Set(['id', 'trackingNumber', '[dynamic-key]', '[token-like-key]'])
    );
    for (const leak of ['person@example.com', '123 St', 'MohammadZaytoun', 'SECRET']) {
      expect(json).not.toContain(leak);
    }
    expect(json).not.toContain('"email"');
    expect(json).not.toContain('"address"');
  });

  it('aggregates value kinds per category so colliding keys do not overwrite', () => {
    const payload = {
      'person@example.com': { a: 1 },
      'other@example.com': 'hello',
      'a-b!': [1],
      'c d?': 2,
    };
    const s = summarizeShape(payload);
    expect(s.keys?.['[email-key]']).toEqual(['object', 'string']);
    expect(s.keys?.['[dynamic-key]']?.slice().sort()).toEqual(['array', 'number']);
  });

  it('buckets sizes and never exposes exact counts', () => {
    expect(summarizeShape([]).size).toBe('empty');
    expect(summarizeShape({ id: 1 }).size).toBe('one');
    expect(summarizeShape({ id: 1, name: 2, status: 3 }).size).toBe('few');
    const bigArr = Array.from({ length: 500 }, (_, i) => i);
    expect(summarizeShape(bigArr).size).toBe('many');
    expect(JSON.stringify(summarizeShape(bigArr))).not.toContain('500');
  });

  it('caps raw property processing on a huge single-category object', () => {
    const payload: Record<string, string> = {};
    for (let i = 0; i < 10_000; i += 1) payload[`person${i}@example.com`] = 'secret';
    const s = summarizeShape(payload);
    expect(s.truncated).toBe(true);
    expect(s.keys?.['[email-key]']).toEqual(['string']);
    expect(Object.keys(s.keys ?? {})).toEqual(['[email-key]']); // one category
    const json = JSON.stringify(s);
    expect(json).not.toContain('person0@example.com');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('10000');
    expect(json).not.toContain('200'); // no exact processed/total count
  });

  it('caps raw processing even across many distinct dynamic keys', () => {
    const payload: Record<string, number> = {};
    for (let i = 0; i < 1000; i += 1) payload[`field-${i}!`] = i; // all → [dynamic-key]
    const s = summarizeShape(payload);
    expect(s.truncated).toBe(true);
    expect(Object.keys(s.keys ?? {})).toEqual(['[dynamic-key]']);
    expect(Object.keys(s.keys ?? {}).length).toBeLessThanOrEqual(40);
  });

  it('summarizes arrays with distinct element kinds', () => {
    expect(summarizeShape([1, 2, 3])).toEqual({ kind: 'array', size: 'few', elements: ['number'] });
    expect(summarizeShape([{ a: 1 }, 'x'])).toEqual({
      kind: 'array',
      size: 'few',
      elements: ['object', 'string'],
    });
  });

  it('never leaks nested values, ignores inherited props, and survives circular input', () => {
    const proto = { inherited: 1 };
    const circular: Record<string, unknown> = Object.create(proto);
    circular['id'] = 1;
    circular['self'] = circular;
    const s = summarizeShape(circular);
    // `self` is not allowlisted → [dynamic-key]; inherited `inherited` is skipped entirely.
    expect(s.keys).toEqual({ id: ['number'], '[dynamic-key]': ['object'] });
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it('never leaks values from a realistic sensitive payload', () => {
    const payload = {
      token: 'SECRET_TOKEN_VALUE',
      email: 'person@example.com',
      trackingNumber: '1111222233334444',
      address: '123 Some Street',
      phone: '0100000000',
    };
    const json = JSON.stringify(summarizeShape(payload));
    for (const secret of Object.values(payload)) {
      expect(json).not.toContain(secret);
    }
  });
});
