import { describe, it, expect } from 'vitest';
import { summarizeShape, sanitizeShapeKey } from './shape';

describe('sanitizeShapeKey (conservative allowlist + sensitive-keyword masking)', () => {
  it('keeps safe schema-like identifiers visible', () => {
    for (const k of ['id', 'name', 'status', 'createdAt', 'countryId', 'trackingNumber', 'items']) {
      expect(sanitizeShapeKey(k)).toBe(k);
    }
  });

  it('masks identifier-shaped secrets before the generic identifier check', () => {
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
      'APIKEYSECRETVALUE',
      'privateKeyMaterial',
    ]) {
      const out = sanitizeShapeKey(k);
      expect(out).toBe('[token-like-key]');
      expect(out).not.toContain(k);
    }
  });

  it('categorizes other dynamic/sensitive keys', () => {
    expect(sanitizeShapeKey('person@example.com')).toBe('[email-key]');
    expect(sanitizeShapeKey('+96170123456')).toBe('[phone-key]');
    expect(sanitizeShapeKey('1111222233334444')).toBe('[numeric-key]');
    expect(sanitizeShapeKey('550e8400-e29b-41d4-a716-446655440000')).toBe('[long-id-key]');
    expect(sanitizeShapeKey('https://example.com/private')).toBe('[url-key]');
    expect(sanitizeShapeKey('a'.repeat(200))).toBe('[long-key]');
    expect(sanitizeShapeKey('col\r\nInjected')).toBe('[dynamic-key]');
  });
});

describe('summarizeShape (privacy-safe, collision-aggregated)', () => {
  it('summarizes primitives and nullish', () => {
    expect(summarizeShape(null)).toEqual({ kind: 'null' });
    expect(summarizeShape('x')).toEqual({ kind: 'string' });
    expect(summarizeShape(1)).toEqual({ kind: 'number' });
    expect(summarizeShape(true)).toEqual({ kind: 'boolean' });
  });

  it('aggregates value kinds per category so colliding keys do not overwrite', () => {
    const payload = {
      'person@example.com': { a: 1 },
      'other@example.com': 'hello',
      'a-b!': [1],
      'c d?': 2,
    };
    const s = summarizeShape(payload);
    expect(s.keys?.['[email-key]']).toEqual(['object', 'string']); // both kinds retained
    // two non-identifier keys aggregated under one category
    expect(s.keys?.['[dynamic-key]']?.slice().sort()).toEqual(['array', 'number']);
    const json = JSON.stringify(s);
    for (const leak of ['person@example.com', 'other@example.com', 'hello', 'a-b', 'c d']) {
      expect(json).not.toContain(leak);
    }
  });

  it('never emits a raw sensitive key and keeps safe keys readable', () => {
    const payload = { BearerSecretToken: 'x', trackingNumber: 'y', id: 1 };
    const s = summarizeShape(payload);
    expect(Object.keys(s.keys ?? {}).sort()).toEqual(['[token-like-key]', 'id', 'trackingNumber']);
    expect(JSON.stringify(s)).not.toContain('BearerSecretToken');
    expect(JSON.stringify(s)).not.toContain('x'); // no value
  });

  it('buckets sizes and never exposes exact counts', () => {
    expect(summarizeShape([]).size).toBe('empty');
    expect(summarizeShape([1]).size).toBe('one');
    expect(summarizeShape([1, 2, 3]).size).toBe('few');
    const big = Array.from({ length: 500 }, (_, i) => i);
    expect(summarizeShape(big).size).toBe('many');
    expect(JSON.stringify(summarizeShape(big))).not.toContain('500');
  });

  it('summarizes arrays with distinct element kinds', () => {
    expect(summarizeShape([1, 2, 3])).toEqual({ kind: 'array', size: 'few', elements: ['number'] });
    expect(summarizeShape([{ a: 1 }, 'x'])).toEqual({
      kind: 'array',
      size: 'few',
      elements: ['object', 'string'],
    });
  });

  it('caps large objects (distinct categories) and flags truncation', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) big[`field${i}`] = i;
    const s = summarizeShape(big);
    expect(s.truncated).toBe(true);
    expect(Object.keys(s.keys ?? {}).length).toBeLessThanOrEqual(40);
  });

  it('never leaks nested values and survives circular input', () => {
    const circular: Record<string, unknown> = { id: 1 };
    circular['self'] = circular;
    const s = summarizeShape(circular);
    expect(s.keys).toEqual({ id: ['number'], self: ['object'] });
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
    // `token` key matches a sensitive keyword → masked (not shown as a readable key).
    expect(json).not.toContain('"token"');
    expect(summarizeShape(payload).keys?.['[token-like-key]']).toEqual(['string']);
  });
});
