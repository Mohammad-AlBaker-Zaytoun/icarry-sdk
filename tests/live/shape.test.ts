import { describe, it, expect } from 'vitest';
import { summarizeShape, sanitizeShapeKey } from './shape';

describe('sanitizeShapeKey (dynamic/sensitive keys categorized)', () => {
  it('keeps safe schema-like identifiers visible', () => {
    for (const k of ['id', 'name', 'status', 'createdAt', 'countryId', 'trackingNumber']) {
      expect(sanitizeShapeKey(k)).toBe(k);
    }
  });

  it('categorizes dynamic/sensitive keys without echoing them', () => {
    const cases: Array<[string, string]> = [
      ['person@example.com', '[email-key]'],
      ['+96170123456', '[phone-key]'],
      ['1111222233334444', '[numeric-key]'],
      ['550e8400-e29b-41d4-a716-446655440000', '[long-id-key]'],
      ['https://example.com/private', '[url-key]'],
      ['Bearer-secret-token', '[token-like-key]'],
      ['TRACKING-123456789', '[dynamic-key]'],
    ];
    for (const [raw, category] of cases) {
      const out = sanitizeShapeKey(raw);
      expect(out).toBe(category);
      expect(out).not.toContain(raw);
    }
  });

  it('truncates extremely long keys and masks control chars', () => {
    expect(sanitizeShapeKey('a'.repeat(200))).toBe('[long-key]');
    expect(sanitizeShapeKey('col\r\nInjected')).toBe('[dynamic-key]');
  });
});

describe('summarizeShape (privacy-safe structural summary)', () => {
  it('summarizes primitives and nullish', () => {
    expect(summarizeShape(null)).toEqual({ kind: 'null' });
    expect(summarizeShape(undefined)).toEqual({ kind: 'undefined' });
    expect(summarizeShape('x')).toEqual({ kind: 'string' });
    expect(summarizeShape(1)).toEqual({ kind: 'number' });
    expect(summarizeShape(true)).toEqual({ kind: 'boolean' });
  });

  it('records sanitized keys + value kinds, never raw keys or values', () => {
    const payload = {
      'person@example.com': { secret: 1 },
      'TRACKING-123456789': 'shipped',
      id: 5,
      status: 'ok',
    };
    const s = summarizeShape(payload);
    const json = JSON.stringify(s);
    expect(s.kind).toBe('object');
    // safe keys visible, sensitive keys categorized
    expect(s.keys).toEqual({
      '[email-key]': 'object',
      '[dynamic-key]': 'string',
      id: 'number',
      status: 'string',
    });
    for (const leak of ['person@example.com', 'TRACKING-123456789', 'shipped', 'secret']) {
      expect(json).not.toContain(leak);
    }
  });

  it('buckets object/array size instead of exact counts', () => {
    expect(summarizeShape([]).size).toBe('empty');
    expect(summarizeShape([1]).size).toBe('one');
    expect(summarizeShape([1, 2, 3]).size).toBe('few');
    expect(summarizeShape(Array.from({ length: 500 }, (_, i) => i)).size).toBe('many');
    // exact length never present
    expect(JSON.stringify(summarizeShape(Array.from({ length: 500 }, (_, i) => i)))).not.toContain(
      '500'
    );
  });

  it('summarizes arrays with distinct element kinds', () => {
    expect(summarizeShape([1, 2, 3])).toEqual({ kind: 'array', size: 'few', elements: ['number'] });
    expect(summarizeShape([{ a: 1 }, 'x'])).toEqual({
      kind: 'array',
      size: 'few',
      elements: ['object', 'string'],
    });
  });

  it('truncates large objects and flags it', () => {
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
    expect(s.keys).toEqual({ id: 'number', self: 'object' }); // nested = kind only
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
